import { createHash, randomBytes } from 'crypto';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { traceError } from '../../common/logger';
import { isFileNotFoundError } from '../../common/platform/errors';
import { IFileSystem } from '../../common/platform/types';
import { IExtensionContext } from '../../common/types';
import { IDigestStorage } from '../types';

// NB: still need to implement automatic culling of least recently used entries
@injectable()
export class DigestStorage implements IDigestStorage {
    public readonly key: Promise<string>;
    private digestDir: Promise<string>;

    constructor(
        @inject(IFileSystem) private fs: IFileSystem,
        @inject(IExtensionContext) private extensionContext: IExtensionContext
    ) {
        this.key = this.initKey();
        this.digestDir = this.initDir();
    }

    public async saveDigest(uri: string, signature: string) {
        const fileName = createHash('sha256').update(uri).digest('hex');
        const fileLocation = path.join(await this.digestDir, fileName);
        // Since the signature is a hex digest, the character 'z' is being used to delimit the start and end of a single digest
        await this.fs.appendFile(fileLocation, `z${signature}z\n`);
    }

    public async containsDigest(uri: string, signature: string) {
        const fileName = createHash('sha256').update(uri).digest('hex');
        const fileLocation = path.join(await this.digestDir, fileName);
        try {
            const digests = await this.fs.readFile(fileLocation);
            return digests.indexOf(`z${signature}z`) >= 0;
        } catch (err) {
            if (!isFileNotFoundError(err)) {
                traceError(err); // Don't log the error if the file simply doesn't exist
            }
            return false;
        }
    }

    private async initDir(): Promise<string> {
        const defaultDigestDirLocation = this.getDefaultLocation('nbsignatures');
        if (!(await this.fs.directoryExists(defaultDigestDirLocation))) {
            await this.fs.createDirectory(defaultDigestDirLocation);
        }
        return defaultDigestDirLocation;
    }

    /**
     * Get or create a local secret key, used in computing HMAC hashes of trusted
     * checkpoints in the notebook's execution history
     */
    private async initKey(): Promise<string> {
        const defaultKeyFileLocation = this.getDefaultLocation('nbsecret');

        if (await this.fs.fileExists(defaultKeyFileLocation)) {
            // if the keyfile already exists, bail out
            return this.fs.readFile(defaultKeyFileLocation);
        } else {
            // If it doesn't exist, create one
            // Key must be generated from a cryptographically secure pseudorandom function:
            // https://nodejs.org/api/crypto.html#crypto_crypto_randombytes_size_callback
            // No callback is provided so random bytes will be generated synchronously
            const key = randomBytes(1024).toString('hex');
            await this.fs.writeFile(defaultKeyFileLocation, key);
            return key;
        }
    }

    private getDefaultLocation(fileName: string) {
        const dir = this.extensionContext.globalStoragePath;
        if (dir) {
            return path.join(dir, fileName);
        }
        throw new Error('Unable to locate extension global storage path for trusted digest storage');
    }
}
