// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// tslint:disable:max-func-body-length chai-vague-errors
// tslint:disable:no-suspicious-comment

import { expect } from 'chai';
import * as fsextra from 'fs-extra';
// prettier-ignore
import {
    convertStat, FileSystem, FileSystemUtils, RawFileSystem
} from '../../../client/common/platform/fileSystem';
// prettier-ignore
import {
    FileType, IFileSystem, IFileSystemUtils, IRawFileSystem
} from '../../../client/common/platform/types';
// prettier-ignore
import {
    assertDoesNotExist, DOES_NOT_EXIST, FSFixture,
    SUPPORTS_SOCKETS, SUPPORTS_SYMLINKS, WINDOWS
} from './utils';

// Note: all functional tests that do not trigger the VS Code "fs" API
// are found in filesystem.functional.test.ts.

suite('FileSystem - raw', () => {
    let filesystem: IRawFileSystem;
    let fix: FSFixture;
    setup(async () => {
        filesystem = RawFileSystem.withDefaults();
        fix = new FSFixture();

        await assertDoesNotExist(DOES_NOT_EXIST);
    });
    teardown(async () => {
        await fix.cleanUp();
    });

    suite('stat', () => {
        test('gets the info for an existing file', async () => {
            const filename = await fix.createFile('x/y/z/spam.py', '...');
            const old = await fsextra.stat(filename);
            const expected = convertStat(old, FileType.File);

            const stat = await filesystem.stat(filename);

            expect(stat).to.deep.equal(expected);
        });

        test('gets the info for an existing directory', async () => {
            const dirname = await fix.createDirectory('x/y/z/spam');
            const old = await fsextra.stat(dirname);
            const expected = convertStat(old, FileType.Directory);

            const stat = await filesystem.stat(dirname);

            expect(stat).to.deep.equal(expected);
        });

        test('for symlinks, gets the info for the linked file', async function() {
            if (!SUPPORTS_SYMLINKS) {
                // tslint:disable-next-line:no-invalid-this
                this.skip();
            }
            const filename = await fix.createFile('x/y/z/spam.py', '...');
            const symlink = await fix.createSymlink('x/y/z/eggs.py', filename);
            const old = await fsextra.stat(filename);
            const expected = convertStat(old, FileType.SymbolicLink | FileType.File);

            const stat = await filesystem.stat(symlink);

            expect(stat).to.deep.equal(expected);
        });

        test('gets the info for a socket', async function() {
            if (!SUPPORTS_SOCKETS) {
                // tslint:disable-next-line:no-invalid-this
                return this.skip();
            }
            const sock = await fix.createSocket('x/spam.sock');
            const old = await fsextra.stat(sock);
            const expected = convertStat(old, FileType.Unknown);

            const stat = await filesystem.stat(sock);

            expect(stat).to.deep.equal(expected);
        });

        test('fails if the file does not exist', async () => {
            const promise = filesystem.stat(DOES_NOT_EXIST);

            await expect(promise).to.eventually.be.rejected;
        });
    });
});

suite('FileSystem - utils', () => {
    let utils: IFileSystemUtils;
    let fix: FSFixture;
    setup(async () => {
        utils = FileSystemUtils.withDefaults();
        fix = new FSFixture();

        await assertDoesNotExist(DOES_NOT_EXIST);
    });
    teardown(async () => {
        await fix.cleanUp();
    });

    suite('pathExists', () => {
        test('exists (without type)', async () => {
            const filename = await fix.createFile('x/y/z/spam.py');

            const exists = await utils.pathExists(filename);

            expect(exists).to.equal(true);
        });

        test('does not exist (without type)', async () => {
            const exists = await utils.pathExists(DOES_NOT_EXIST);

            expect(exists).to.equal(false);
        });

        test('matches (type: file)', async () => {
            const filename = await fix.createFile('x/y/z/spam.py');

            const exists = await utils.pathExists(filename, FileType.File);

            expect(exists).to.equal(true);
        });

        test('mismatch (type: file)', async () => {
            const filename = await fix.createDirectory('x/y/z/spam.py');

            const exists = await utils.pathExists(filename, FileType.File);

            expect(exists).to.equal(false);
        });

        test('matches (type: directory)', async () => {
            const dirname = await fix.createDirectory('x/y/z/spam');

            const exists = await utils.pathExists(dirname, FileType.Directory);

            expect(exists).to.equal(true);
        });

        test('mismatch (type: directory)', async () => {
            const dirname = await fix.createFile('x/y/z/spam');

            const exists = await utils.pathExists(dirname, FileType.Directory);

            expect(exists).to.equal(false);
        });

        test('symlinks are followed', async function() {
            if (!SUPPORTS_SYMLINKS) {
                // tslint:disable-next-line:no-invalid-this
                this.skip();
            }
            const filename = await fix.createFile('x/y/z/spam.py', '...');
            const symlink = await fix.createSymlink('x/y/z/eggs.py', filename);

            const exists = await utils.pathExists(symlink, FileType.SymbolicLink);
            const destIsFile = await utils.pathExists(symlink, FileType.File);
            const destIsDir = await utils.pathExists(symlink, FileType.Directory);

            expect(exists).to.equal(true);
            expect(destIsFile).to.equal(true);
            expect(destIsDir).to.equal(false);
        });

        test('mismatch (type: symlink)', async () => {
            const filename = await fix.createFile('x/y/z/spam.py');

            const exists = await utils.pathExists(filename, FileType.SymbolicLink);

            expect(exists).to.equal(false);
        });

        test('matches (type: unknown)', async function() {
            if (!SUPPORTS_SOCKETS) {
                // tslint:disable-next-line:no-invalid-this
                this.skip();
            }
            const sockFile = await fix.createSocket('x/y/z/ipc.sock');

            const exists = await utils.pathExists(sockFile, FileType.Unknown);

            expect(exists).to.equal(true);
        });

        test('mismatch (type: unknown)', async () => {
            const filename = await fix.createFile('x/y/z/spam.py');

            const exists = await utils.pathExists(filename, FileType.Unknown);

            expect(exists).to.equal(false);
        });
    });

    suite('fileExists', () => {
        test('want file, got file', async () => {
            const filename = await fix.createFile('x/y/z/spam.py');

            const exists = await utils.fileExists(filename);

            expect(exists).to.equal(true);
        });

        test('want file, not file', async () => {
            const filename = await fix.createDirectory('x/y/z/spam.py');

            const exists = await utils.fileExists(filename);

            expect(exists).to.equal(false);
        });

        test('symlink', async function() {
            if (!SUPPORTS_SYMLINKS) {
                // tslint:disable-next-line:no-invalid-this
                this.skip();
            }
            const filename = await fix.createFile('x/y/z/spam.py', '...');
            const symlink = await fix.createSymlink('x/y/z/eggs.py', filename);

            const exists = await utils.fileExists(symlink);

            // This is because we currently use stat() and not lstat().
            expect(exists).to.equal(true);
        });

        test('unknown', async function() {
            if (!SUPPORTS_SOCKETS) {
                // tslint:disable-next-line:no-invalid-this
                this.skip();
            }
            const sockFile = await fix.createSocket('x/y/z/ipc.sock');

            const exists = await utils.fileExists(sockFile);

            expect(exists).to.equal(false);
        });

        test('failure in stat()', async function() {
            if (WINDOWS) {
                // tslint:disable-next-line:no-invalid-this
                this.skip();
            }
            const dirname = await fix.createDirectory('x/y/z');
            const filename = await fix.createFile('x/y/z/spam.py', '...');
            await fsextra.chmod(dirname, 0o400);

            let exists: boolean;
            try {
                exists = await utils.fileExists(filename);
            } finally {
                await fsextra.chmod(dirname, 0o755);
            }

            expect(exists).to.equal(false);
        });
    });

    suite('directoryExists', () => {
        test('want directory, got directory', async () => {
            const dirname = await fix.createDirectory('x/y/z/spam');

            const exists = await utils.directoryExists(dirname);

            expect(exists).to.equal(true);
        });

        test('want directory, not directory', async () => {
            const dirname = await fix.createFile('x/y/z/spam');

            const exists = await utils.directoryExists(dirname);

            expect(exists).to.equal(false);
        });

        test('symlink', async () => {
            const dirname = await fix.createDirectory('x/y/z/spam');
            const symlink = await fix.createSymlink('x/y/z/eggs', dirname);

            const exists = await utils.directoryExists(symlink);

            // This is because we currently use stat() and not lstat().
            expect(exists).to.equal(true);
        });

        test('unknown', async function() {
            if (!SUPPORTS_SOCKETS) {
                // tslint:disable-next-line:no-invalid-this
                this.skip();
            }
            const sockFile = await fix.createSocket('x/y/z/ipc.sock');

            const exists = await utils.directoryExists(sockFile);

            expect(exists).to.equal(false);
        });

        test('failure in stat()', async function() {
            if (WINDOWS) {
                // tslint:disable-next-line:no-invalid-this
                this.skip();
            }
            const parentdir = await fix.createDirectory('x/y/z');
            const dirname = await fix.createDirectory('x/y/z/spam');
            await fsextra.chmod(parentdir, 0o400);

            let exists: boolean;
            try {
                exists = await utils.fileExists(dirname);
            } finally {
                await fsextra.chmod(parentdir, 0o755);
            }

            expect(exists).to.equal(false);
        });
    });

    suite('getSubDirectories', () => {
        test('empty if the directory does not exist', async () => {
            const entries = await utils.getSubDirectories(DOES_NOT_EXIST);

            expect(entries).to.deep.equal([]);
        });
    });

    suite('getFiles', () => {
        test('empty if the directory does not exist', async () => {
            const entries = await utils.getFiles(DOES_NOT_EXIST);

            expect(entries).to.deep.equal([]);
        });
    });
});

suite('FileSystem', () => {
    let filesystem: IFileSystem;
    let fix: FSFixture;
    setup(async () => {
        filesystem = new FileSystem();
        fix = new FSFixture();

        await assertDoesNotExist(DOES_NOT_EXIST);
    });
    teardown(async () => {
        await fix.cleanUp();
    });

    suite('raw', () => {
        suite('stat', () => {
            test('gets the info for an existing file', async () => {
                const filename = await fix.createFile('x/y/z/spam.py', '...');
                const old = await fsextra.stat(filename);
                const expected = convertStat(old, FileType.File);

                const stat = await filesystem.stat(filename);

                expect(stat).to.deep.equal(expected);
            });

            test('gets the info for an existing directory', async () => {
                const dirname = await fix.createDirectory('x/y/z/spam');
                const old = await fsextra.stat(dirname);
                const expected = convertStat(old, FileType.Directory);

                const stat = await filesystem.stat(dirname);

                expect(stat).to.deep.equal(expected);
            });

            test('for symlinks, gets the info for the linked file', async function() {
                if (!SUPPORTS_SYMLINKS) {
                    // tslint:disable-next-line:no-invalid-this
                    this.skip();
                }
                const filename = await fix.createFile('x/y/z/spam.py', '...');
                const symlink = await fix.createSymlink('x/y/z/eggs.py', filename);
                const old = await fsextra.stat(filename);
                const expected = convertStat(old, FileType.SymbolicLink | FileType.File);

                const stat = await filesystem.stat(symlink);

                expect(stat).to.deep.equal(expected);
            });

            test('gets the info for a socket', async function() {
                if (!SUPPORTS_SOCKETS) {
                    // tslint:disable-next-line:no-invalid-this
                    return this.skip();
                }
                const sock = await fix.createSocket('x/spam.sock');
                const old = await fsextra.stat(sock);
                const expected = convertStat(old, FileType.Unknown);

                const stat = await filesystem.stat(sock);

                expect(stat).to.deep.equal(expected);
            });

            test('fails if the file does not exist', async () => {
                const promise = filesystem.stat(DOES_NOT_EXIST);

                await expect(promise).to.eventually.be.rejected;
            });
        });
    });

    suite('utils', () => {
        suite('fileExists', () => {
            test('want file, got file', async () => {
                const filename = await fix.createFile('x/y/z/spam.py');

                const exists = await filesystem.fileExists(filename);

                expect(exists).to.equal(true);
            });

            test('want file, not file', async () => {
                const filename = await fix.createDirectory('x/y/z/spam.py');

                const exists = await filesystem.fileExists(filename);

                expect(exists).to.equal(false);
            });

            test('symlink', async function() {
                if (!SUPPORTS_SYMLINKS) {
                    // tslint:disable-next-line:no-invalid-this
                    this.skip();
                }
                const filename = await fix.createFile('x/y/z/spam.py', '...');
                const symlink = await fix.createSymlink('x/y/z/eggs.py', filename);

                const exists = await filesystem.fileExists(symlink);

                // This is because we currently use stat() and not lstat().
                expect(exists).to.equal(true);
            });

            test('unknown', async function() {
                if (!SUPPORTS_SOCKETS) {
                    // tslint:disable-next-line:no-invalid-this
                    this.skip();
                }
                const sockFile = await fix.createSocket('x/y/z/ipc.sock');

                const exists = await filesystem.fileExists(sockFile);

                expect(exists).to.equal(false);
            });
        });

        suite('directoryExists', () => {
            test('want directory, got directory', async () => {
                const dirname = await fix.createDirectory('x/y/z/spam');

                const exists = await filesystem.directoryExists(dirname);

                expect(exists).to.equal(true);
            });

            test('want directory, not directory', async () => {
                const dirname = await fix.createFile('x/y/z/spam');

                const exists = await filesystem.directoryExists(dirname);

                expect(exists).to.equal(false);
            });

            test('symlink', async () => {
                const dirname = await fix.createDirectory('x/y/z/spam');
                const symlink = await fix.createSymlink('x/y/z/eggs', dirname);

                const exists = await filesystem.directoryExists(symlink);

                // This is because we currently use stat() and not lstat().
                expect(exists).to.equal(true);
            });

            test('unknown', async function() {
                if (!SUPPORTS_SOCKETS) {
                    // tslint:disable-next-line:no-invalid-this
                    this.skip();
                }
                const sockFile = await fix.createSocket('x/y/z/ipc.sock');

                const exists = await filesystem.directoryExists(sockFile);

                expect(exists).to.equal(false);
            });
        });

        suite('getSubDirectories', () => {
            test('empty if the directory does not exist', async () => {
                const entries = await filesystem.getSubDirectories(DOES_NOT_EXIST);

                expect(entries).to.deep.equal([]);
            });
        });

        suite('getFiles', () => {
            test('empty if the directory does not exist', async () => {
                const entries = await filesystem.getFiles(DOES_NOT_EXIST);

                expect(entries).to.deep.equal([]);
            });
        });
    });
});
