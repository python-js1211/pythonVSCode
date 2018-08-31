'use strict';
// tslint:disable: no-any one-line no-suspicious-comment prefer-template prefer-const no-unnecessary-callback-wrapper no-function-expression no-string-literal no-control-regex no-shadowed-variable

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Position, Range, TextDocument } from 'vscode';
import { IRandom } from './types';
import { isNumber } from './variables/sysTypes';

export const IS_WINDOWS = /^win/.test(process.platform);
export const Is_64Bit = os.arch() === 'x64';
export const PATH_VARIABLE_NAME = IS_WINDOWS ? 'Path' : 'PATH';

export function fsExistsAsync(filePath: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
        fs.exists(filePath, exists => {
            return resolve(exists);
        });
    });
}
export function fsReaddirAsync(root: string): Promise<string[]> {
    return new Promise<string[]>(resolve => {
        // Now look for Interpreters in this directory
        fs.readdir(root, (err, subDirs) => {
            if (err) {
                return resolve([]);
            }
            resolve(subDirs.map(subDir => path.join(root, subDir)));
        });
    });
}

export function formatErrorForLogging(error: Error | string): string {
    let message: string = '';
    if (typeof error === 'string') {
        message = error;
    }
    else {
        if (error.message) {
            message = `Error Message: ${error.message}`;
        }
        if (error.name && error.message.indexOf(error.name) === -1) {
            message += `, (${error.name})`;
        }
        const innerException = (error as any).innerException;
        if (innerException && (innerException.message || innerException.name)) {
            if (innerException.message) {
                message += `, Inner Error Message: ${innerException.message}`;
            }
            if (innerException.name && innerException.message.indexOf(innerException.name) === -1) {
                message += `, (${innerException.name})`;
            }
        }
    }
    return message;
}

export function getSubDirectories(rootDir: string): Promise<string[]> {
    return new Promise<string[]>(resolve => {
        fs.readdir(rootDir, (error, files) => {
            if (error) {
                return resolve([]);
            }
            const subDirs: string[] = [];
            files.forEach(name => {
                const fullPath = path.join(rootDir, name);
                try {
                    if (fs.statSync(fullPath).isDirectory()) {
                        subDirs.push(fullPath);
                    }
                }
                // tslint:disable-next-line:no-empty
                catch (ex) { }
            });
            resolve(subDirs);
        });
    });
}

export function getWindowsLineEndingCount(document: TextDocument, offset: Number) {
    const eolPattern = new RegExp('\r\n', 'g');
    const readBlock = 1024;
    let count = 0;
    let offsetDiff = offset.valueOf();

    // In order to prevent the one-time loading of large files from taking up too much memory
    for (let pos = 0; pos < offset; pos += readBlock) {
        let startAt = document.positionAt(pos);
        let endAt: Position;

        if (offsetDiff >= readBlock) {
            endAt = document.positionAt(pos + readBlock);
            offsetDiff = offsetDiff - readBlock;
        } else {
            endAt = document.positionAt(pos + offsetDiff);
        }

        let text = document.getText(new Range(startAt, endAt!));
        let cr = text.match(eolPattern);

        count += cr ? cr.length : 0;
    }
    return count;
}

export function arePathsSame(path1: string, path2: string) {
    path1 = path.normalize(path1);
    path2 = path.normalize(path2);
    if (IS_WINDOWS) {
        return path1.toUpperCase() === path2.toUpperCase();
    } else {
        return path1 === path2;
    }
}

function getRandom(): number {
    let num: number = 0;

    const buf: Buffer = crypto.randomBytes(2);
    num = (buf.readUInt8(0) << 8) + buf.readUInt8(1);

    const maxValue: number = Math.pow(16, 4) - 1;
    return (num / maxValue);
}

export function getRandomBetween(min: number = 0, max: number = 10): number {
    const randomVal: number = getRandom();
    return min + (randomVal * (max - min));
}

export class Random implements IRandom {

    public getRandomInt(min: number = 0, max: number = 10): number {
        return getRandomBetween(min, max);
    }
}

/**
 * Return [parent name, name] for the given qualified (dotted) name.
 *
 * Examples:
 *  'x.y'   -> ['x', 'y']
 *  'x'     -> ['', 'x']
 *  'x.y.z' -> ['x.y', 'z']
 *  ''      -> ['', '']
 */
export function splitParent(fullName: string): [string, string] {
    if (fullName.length === 0) {
        return ['', ''];
    }
    const pos = fullName.lastIndexOf('.');
    if (pos < 0) {
        return ['', fullName];
    }
    const parentName = fullName.slice(0, pos);
    const name = fullName.slice(pos + 1);
    return [parentName, name];
}

/**
 * Return the range represented by the given string.
 *
 * If a number is provided then it is used as both lines and the
 * character are set to 0.
 *
 * Examples:
 *  '1:5-3:5' -> Range(1, 5, 3, 5)
 *  '1-3'     -> Range(1, 0, 3, 0)
 *  '1:3-1:5' -> Range(1, 3, 1, 5)
 *  '1-1'     -> Range(1, 0, 1, 0)
 *  '1'       -> Range(1, 0, 1, 0)
 *  '1:3-'    -> Range(1, 3, 1, 0)
 *  '1:3'     -> Range(1, 3, 1, 0)
 *  ''        -> Range(0, 0, 0, 0)
 *  '3-1'     -> Range(1, 0, 3, 0)
 */
export function parseRange(raw: string | number): Range {
    if (isNumber(raw)) {
        return new Range(raw, 0, raw, 0);
    }
    if (raw === '') {
        return new Range(0, 0, 0, 0);
    }

    const parts = raw.split('-');
    if (parts.length > 2) {
        throw new Error(`invalid range ${raw}`);
    }

    const start = parsePosition(parts[0]);
    let end = start;
    if (parts.length === 2) {
        end = parsePosition(parts[1]);
    }
    return new Range(start, end);
}

/**
 * Return the line/column represented by the given string.
 *
 * If a number is provided then it is used as the line and the character
 * is set to 0.
 *
 * Examples:
 *  '1:5' -> Position(1, 5)
 *  '1'   -> Position(1, 0)
 *  ''    -> Position(0, 0)
 */
export function parsePosition(raw: string | number): Position {
    if (isNumber(raw)) {
        return new Position(raw, 0);
    }
    if (raw === '') {
        return new Position(0, 0);
    }

    const parts = raw.split(':');
    if (parts.length > 2) {
        throw new Error(`invalid position ${raw}`);
    }

    let line = 0;
    if (parts[0] !== '') {
        if (!/^\d+$/.test(parts[0])) {
            throw new Error(`invalid position ${raw}`);
        }
        line = +parts[0];
    }
    let col = 0;
    if (parts.length === 2 && parts[1] !== '') {
        if (!/^\d+$/.test(parts[1])) {
            throw new Error(`invalid position ${raw}`);
        }
        col = +parts[1];
    }
    return new Position(line, col);
}
