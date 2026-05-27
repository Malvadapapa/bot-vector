"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseConnection = void 0;
const sqlite3_1 = __importDefault(require("sqlite3"));
const path_1 = __importDefault(require("path"));
const fs = __importStar(require("fs"));
const migrations_js_1 = require("./db/migrations.js");
class DatabaseConnection {
    constructor(dbFilePath) {
        const dataDir = path_1.default.join(process.cwd(), 'data');
        const finalPath = dbFilePath || path_1.default.join(dataDir, 'chatbot.db');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            console.log(`[BD] Directorio de datos creado: ${dataDir}`);
        }
        this.ready = new Promise((resolve, reject) => {
            this.db = new sqlite3_1.default.Database(finalPath, async (err) => {
                if (err) {
                    console.error(`[BD] No se pudo abrir la base de datos: ${err.message}`);
                    reject(err);
                    return;
                }
                try {
                    console.log(`[BD] Conectado a: ${finalPath}`);
                    await (0, migrations_js_1.applyMigrations)(this.db);
                    console.log('[BD] Esquema verificado y migraciones aplicadas');
                    resolve();
                }
                catch (migrationErr) {
                    const msg = migrationErr?.message || 'error desconocido';
                    console.error(`[BD] Error aplicando migraciones: ${msg}`);
                    reject(migrationErr);
                }
            });
            this.db?.on('error', (dbErr) => {
                console.error(`[BD] Error de base de datos: ${dbErr.message}`);
            });
        });
    }
    async waitUntilReady() {
        await this.ready;
    }
    getDb() {
        return this.db;
    }
    close() {
        this.db.close((err) => {
            if (err) {
                console.error(`[BD] Error al cerrar la base de datos: ${err.message}`);
            }
            else {
                console.log('[BD] Base de datos cerrada');
            }
        });
    }
}
exports.DatabaseConnection = DatabaseConnection;
