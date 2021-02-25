// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs';
import * as path from 'path';
import { EOL } from 'os';
import * as vscode from 'vscode';
import { logError } from '../../logging';
import { getOSType, OSType } from './platform';

/**
 * Produce a uniform representation of the given filename.
 *
 * The result is especially suitable for cases where a filename is used
 * as a key (e.g. in a mapping).
 */
export function normalizeFilename(filename: string): string {
    // `path.resolve()` returns the absolute path.  Note that it also
    // has the same behavior as `path.normalize()`.
    const resolved = path.resolve(filename);
    return getOSType() === OSType.Windows ? resolved.toLowerCase() : resolved;
}

/**
 * Decide if the two filenames are the same file.
 *
 * This only checks the filenames (after normalizing) and does not
 * resolve symlinks or other indirection.
 */
export function areSameFilename(filename1: string, filename2: string): boolean {
    const norm1 = normalizeFilename(filename1);
    const norm2 = normalizeFilename(filename2);
    return norm1 === norm2;
}

export import FileType = vscode.FileType;

export type DirEntry = {
    filename: string;
    filetype: FileType;
};

interface IKnowsFileType {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}

// This helper function determines the file type of the given stats
// object.  The type follows the convention of node's fs module, where
// a file has exactly one type.  Symlinks are not resolved.
export function convertFileType(info: IKnowsFileType): FileType {
    if (info.isFile()) {
        return FileType.File;
    }
    if (info.isDirectory()) {
        return FileType.Directory;
    }
    if (info.isSymbolicLink()) {
        // The caller is responsible for combining this ("logical or")
        // with File or Directory as necessary.
        return FileType.SymbolicLink;
    }
    return FileType.Unknown;
}

/**
 * Identify the file type for the given file.
 */
export async function getFileType(
    filename: string,
    opts: {
        ignoreErrors: boolean;
    } = { ignoreErrors: true },
): Promise<FileType | undefined> {
    let stat: fs.Stats;
    try {
        stat = await fs.promises.lstat(filename);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return undefined;
        }
        if (opts.ignoreErrors) {
            logError(`lstat() failed for "${filename}" (${err})`);
            return FileType.Unknown;
        }
        throw err; // re-throw
    }
    return convertFileType(stat);
}

function normalizeFileTypes(filetypes: FileType | FileType[] | undefined): FileType[] | undefined {
    if (filetypes === undefined) {
        return undefined;
    }
    if (Array.isArray(filetypes)) {
        if (filetypes.length === 0) {
            return undefined;
        }
        return filetypes;
    }
    return [filetypes];
}

async function resolveFile(
    file: string | DirEntry,
    opts: {
        ensure?: boolean;
        onMissing?: FileType;
    } = {},
): Promise<DirEntry | undefined> {
    let filename: string;
    if (typeof file !== 'string') {
        if (!opts.ensure) {
            if (opts.onMissing === undefined) {
                return file;
            }
            // At least make sure it exists.
            if ((await getFileType(file.filename)) !== undefined) {
                return file;
            }
        }
        filename = file.filename;
    } else {
        filename = file;
    }

    const filetype = (await getFileType(filename)) || opts.onMissing;
    if (filetype === undefined) {
        return undefined;
    }
    return { filename, filetype };
}

type FileFilterFunc = (file: string | DirEntry) => Promise<boolean>;

export function getFileFilter(
    opts: {
        ignoreMissing?: boolean;
        ignoreFileType?: FileType | FileType[];
        ensureEntry?: boolean;
    } = {
        ignoreMissing: true,
    },
): FileFilterFunc | undefined {
    const ignoreFileType = normalizeFileTypes(opts.ignoreFileType);

    if (!opts.ignoreMissing && !ignoreFileType) {
        // Do not filter.
        return undefined;
    }

    async function filterFile(file: string | DirEntry): Promise<boolean> {
        let entry = await resolveFile(file, { ensure: opts.ensureEntry });
        if (!entry) {
            if (opts.ignoreMissing) {
                return false;
            }
            const filename = typeof file === 'string' ? file : file.filename;
            entry = { filename, filetype: FileType.Unknown };
        }
        if (ignoreFileType) {
            if (ignoreFileType.includes(entry!.filetype)) {
                return false;
            }
        }
        return true;
    }
    return filterFile;
}

/**
 * Generates a string representation of the content of a directory tree.
 *
 * This is only meant as a helper, to be used temporarily while
 * trouble-shooting filesystem-related code.  It should not be
 * used in any released code.
 */
export async function renderFSTree(
    root: string,
    opts: {
        indent?: string;
        maxDepth?: number;
    },
): Promise<string> {
    const subOpts = {
        indent: opts.indent || '  ',
        maxDepth: opts.maxDepth,
    };
    if (opts.maxDepth !== undefined && opts.maxDepth < 0) {
        subOpts.maxDepth = 0;
    }
    const lines = await renderFSTreeLines(root, root, 0, subOpts);
    return lines.join(EOL);
}

async function renderFSTreeLines(
    root: string,
    rootname: string,
    depth: number,
    opts: {
        indent: string;
        maxDepth?: number;
    },
): Promise<string[]> {
    const lines = [
        // Add the root without indenting.
        `${rootname}${path.sep}`,
    ];
    if (opts.maxDepth !== undefined && depth > opts.maxDepth) {
        lines.push(`${opts.indent}...`);
        return lines;
    }
    const entries = await fs.promises.readdir(root);
    for (const name of entries) {
        const filename = path.join(root, name);
        const stat = await fs.promises.lstat(filename);
        let sublines: string[];
        if (stat.isDirectory()) {
            sublines = await renderFSTreeLines(filename, name, depth + 1, opts);
        } else if (stat.isSymbolicLink()) {
            const linked = await fs.promises.readlink(filename);
            sublines = [`${name} -> ${linked}`];
        } else {
            sublines = [name];
        }
        // Add the directory contents, with indentation.
        lines.push(...sublines.map((line) => `${opts.indent}${line}`));
    }
    return lines;
}
