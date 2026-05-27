"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncState = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
class SyncState {
    constructor(stateFilePath) {
        this.stateFilePath = stateFilePath;
    }
    async getFileHash(filePath) {
        const fileBuffer = await promises_1.default.readFile(filePath);
        const hashSum = node_crypto_1.default.createHash('sha256');
        hashSum.update(fileBuffer);
        return hashSum.digest('hex');
    }
    async loadState() {
        try {
            const data = await promises_1.default.readFile(this.stateFilePath, 'utf8');
            return JSON.parse(data);
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return {};
            }
            throw error;
        }
    }
    async saveState(state) {
        const dir = node_path_1.default.dirname(this.stateFilePath);
        await promises_1.default.mkdir(dir, { recursive: true });
        await promises_1.default.writeFile(this.stateFilePath, JSON.stringify(state, null, 2), 'utf8');
    }
}
exports.SyncState = SyncState;
