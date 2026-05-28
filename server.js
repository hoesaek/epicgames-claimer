import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import cron from 'node-cron';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8080;
const CONFIG_PATH = path.join(__dirname, 'config.json');

app.use(express.json());

// Auth middleware
app.use((req, res, next) => {
    try {
        const config = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
        if (!config.dashboard_password) return next();
        const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
        const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
        if (login === 'admin' && password === config.dashboard_password) {
            return next();
        }
        res.set('WWW-Authenticate', 'Basic realm="Epic Dashboard"');
        res.status(401).send('Authentification requise. Utilisateur: admin');
    } catch (e) {
        next();
    }
});

app.use(express.static(path.join(__dirname, 'public')));

let botStatus = "En veille"; // "En veille", "En cours d'exécution", "Erreur"
let botLogs = [];

app.get('/api/status', (req, res) => {
    res.json({ status: botStatus });
});

app.get('/api/logs', (req, res) => {
    res.json({ logs: botLogs });
});

app.get('/api/games', (req, res) => {
    try {
        const dbPath = path.join(__dirname, 'epic-games.json');
        if (fs.existsSync(dbPath)) {
            const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            res.json(data);
        } else {
            res.json({});
        }
    } catch (err) {
        res.status(500).json({ error: "Erreur lecture db" });
    }
});

app.get('/api/screenshot', (req, res) => {
    const p = path.join(__dirname, 'screenshots', 'latest.jpg');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).send('No screenshot');
});

app.get('/api/settings', (req, res) => {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json({});
        }
    } catch (err) {
        res.status(500).json({ error: "Erreur lors de la lecture de la configuration" });
    }
});

app.post('/api/settings', (req, res) => {
    try {
        const currentConfig = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
        const newConfig = { ...currentConfig, ...req.body };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2));
        res.json({ success: true, config: newConfig });
    } catch (err) {
        res.status(500).json({ error: "Erreur lors de la sauvegarde de la configuration" });
    }
});

function runBot() {
    if (botStatus === "En cours d'exécution") return;

    botStatus = "En cours d'exécution";
    botLogs = ["=== Lancement automatique / manuel ==="];
    
    const botProcess = spawn('node', ['bot.js'], { cwd: __dirname });

    botProcess.stdout.on('data', (data) => {
        const text = data.toString();
        botLogs.push(text);
    });

    botProcess.stderr.on('data', (data) => {
        const text = data.toString();
        botLogs.push(`[ERROR] ${text}`);
    });

    botProcess.on('close', (code) => {
        botLogs.push(`=== Process finished with code ${code} ===`);
        botStatus = code === 0 ? "Idle" : "Error";
    });
}

// Lancer le bot automatiquement tous les jours à 18h00 (heure locale)
// Les nouveaux jeux Epic Games sortent généralement le jeudi à 17h00.
cron.schedule('0 18 * * *', () => {
    console.log(chalk.yellow("▶ Scheduled execution of the bot..."));
    runBot();
});

app.post('/api/claim', (req, res) => {
    if (botStatus === "En cours d'exécution") {
        return res.status(400).json({ error: "Bot is already running." });
    }
    
    res.json({ message: "Bot started successfully." });
    runBot();
});

app.listen(PORT, () => {
    console.log(chalk.gray(`▶ Server started on http://localhost:${PORT}`));
    console.log(chalk.gray(`▶ Automatic schedule activated (Daily free game check).`));
});
