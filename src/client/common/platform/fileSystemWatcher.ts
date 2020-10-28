// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as chokidar from 'chokidar';
import * as path from 'path';
import { RelativePattern, workspace } from 'vscode';
import { traceError, traceVerbose, traceWarning } from '../logger';
import { normCasePath } from './fs-paths';

/**
 * Enumeration of file change types.
 */
export enum FileChangeType {
    Changed = 1,
    Created = 2,
    Deleted = 3
}
const POLLING_INTERVAL = 5000;

export function watchLocationForPattern(
    baseDir: string,
    pattern: string,
    callback: (type: FileChangeType, absPath: string) => void
): void {
    // Use VSCode API iff base directory to exists within the current workspace folders
    const found = workspace.workspaceFolders?.find((e) => normCasePath(baseDir).startsWith(normCasePath(e.uri.fsPath)));
    if (found) {
        watchLocationUsingVSCodeAPI(baseDir, pattern, callback);
    } else {
        // Fallback to chokidar as base directory to lookup doesn't exist within the current workspace folders
        watchLocationUsingChokidar(baseDir, pattern, callback);
    }
}

function watchLocationUsingVSCodeAPI(
    baseDir: string,
    pattern: string,
    callback: (type: FileChangeType, absPath: string) => void
) {
    const globPattern = new RelativePattern(baseDir, pattern);
    traceVerbose(`Start watching: ${baseDir} with pattern ${pattern} using VSCode API`);
    const watcher = workspace.createFileSystemWatcher(globPattern);
    watcher.onDidCreate((e) => callback(FileChangeType.Created, e.fsPath));
    watcher.onDidChange((e) => callback(FileChangeType.Changed, e.fsPath));
    watcher.onDidDelete((e) => callback(FileChangeType.Deleted, e.fsPath));
}

function watchLocationUsingChokidar(
    baseDir: string,
    pattern: string,
    callback: (type: FileChangeType, absPath: string) => void
) {
    const watcherOpts: chokidar.WatchOptions = {
        cwd: baseDir,
        ignoreInitial: true,
        ignorePermissionErrors: true,
        // While not used in normal cases, if any error causes chokidar to fallback to polling, increase its intervals
        interval: POLLING_INTERVAL,
        binaryInterval: POLLING_INTERVAL,
        /* 'depth' doesn't matter given regex restricts the depth to 2, same goes for other properties below
         * But using them just to be safe in case it's misused */
        depth: 2,
        ignored: [
            '**/Lib/**',
            '**/.git/**',
            '**/node_modules/*/**',
            '**/.hg/store/**',
            '/dev/**',
            '/proc/**',
            '/sys/**'
        ], // https://github.com/microsoft/vscode/issues/23954
        followSymlinks: false
    };
    traceVerbose(`Start watching: ${baseDir} with pattern ${pattern} using chokidar`);
    let watcher: chokidar.FSWatcher | null = chokidar.watch(pattern, watcherOpts);
    watcher.on('all', (type: string, e: string) => {
        const absPath = path.join(baseDir, e);
        let eventType: FileChangeType;
        switch (type) {
            case 'change':
                eventType = FileChangeType.Changed;
                break;
            case 'add':
            case 'addDir':
                eventType = FileChangeType.Created;
                break;
            case 'unlink':
            case 'unlinkDir':
                eventType = FileChangeType.Deleted;
                break;
            default:
                return;
        }
        callback(eventType, absPath);
    });

    watcher.on('error', async (error: NodeJS.ErrnoException) => {
        if (error) {
            // Specially handle ENOSPC errors that can happen when
            // the watcher consumes so many file descriptors that
            // we are running into a limit. We only want to warn
            // once in this case to avoid log spam.
            // See https://github.com/Microsoft/vscode/issues/7950
            if (error.code === 'ENOSPC') {
                traceError(`Inotify limit reached (ENOSPC) for ${baseDir} with pattern ${pattern}`);
                if (watcher) {
                    await watcher.close();
                    watcher = null;
                }
            } else {
                traceWarning(error.toString());
            }
        }
    });
}
