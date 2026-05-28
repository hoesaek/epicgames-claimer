import { firefox } from 'playwright-firefox';
import { authenticator } from 'otplib';
import chalk from 'chalk';
import path from 'path';
import { existsSync, writeFileSync, appendFileSync, readFileSync } from 'fs';

const datetime = () => new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
const filenamify = (str) => str.replace(/[^a-z0-9]/gi, '_').toLowerCase();

let rawConfig = {};
try {
  rawConfig = JSON.parse(readFileSync('./config.json', 'utf8'));
} catch (e) {
  console.log('No config.json found or invalid JSON.');
}

const cfg = {
  headless: true,
  width: 1280,
  height: 720,
  timeout: 30000,
  login_timeout: 180000,
  dir: {
    browser: './browser_data',
    screenshots: './screenshots'
  },
  debug: false,
  webhookUrl: rawConfig.webhookUrl || '',
  eg_email: rawConfig.eg_email || '',
  eg_password: rawConfig.eg_password || '',
  eg_otpkey: rawConfig.eg_otpkey || '',
  eg_parentalpin: rawConfig.eg_parentalpin || '',
  flaresolverr_url: rawConfig.flaresolverr_url || ''
};

const notify = async (msg, embeds = []) => {
    console.log(chalk.yellow('[NOTIFY]'), msg);
    if (cfg.webhookUrl) {
        try {
            const payload = { content: msg.replace(/<br>/g, '\n') };
            if (embeds.length > 0) payload.embeds = embeds;
            await fetch(cfg.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (err) {
            console.error('Failed to send webhook', err);
        }
    }
};

const html_game_list = (games) => games.map(g => `- ${g.title}: ${g.status}`).join('<br>');
const stealth = async (context) => {
  const enabledEvasions = [
    'chrome.app', 'chrome.csi', 'chrome.loadTimes', 'chrome.runtime',
    'iframe.contentWindow', 'media.codecs', 'navigator.hardwareConcurrency',
    'navigator.languages', 'navigator.permissions', 'navigator.plugins',
    'navigator.webdriver', 'sourceurl', 'webgl.vendor', 'window.outerdimensions',
  ];
  const stealthCtx = {
    callbacks: [],
    async evaluateOnNewDocument(...args) {
      this.callbacks.push({ cb: args[0], a: args[1] });
    },
  };
  for (const e of enabledEvasions) {
    const evasion = await import(`puppeteer-extra-plugin-stealth/evasions/${e}/index.js`);
    evasion.default().onPageCreated(stealthCtx);
  }
  for (const evasion of stealthCtx.callbacks) {
    await context.addInitScript(evasion.cb, evasion.a);
  }
};
const handleSIGINT = () => {}; // Stub

const jsonDb = async (file, defaultData) => {
    let data = defaultData;
    if (existsSync(file)) data = JSON.parse(readFileSync(file, 'utf8'));
    return {
        data,
        write: async () => writeFileSync(file, JSON.stringify(data, null, 2))
    };
};

const resolve = (...args) => path.resolve(...args);
const screenshot = (...a) => resolve(cfg.dir.screenshots, 'epic-games', ...a);

const URL_CLAIM = 'https://store.epicgames.com/en-US/free-games';
const URL_LOGIN = 'https://www.epicgames.com/id/login?lang=en-US&noHostRedirect=true&redirectUrl=' + encodeURIComponent(URL_CLAIM);

import fs from 'fs';
if (!fs.existsSync(cfg.dir.browser)) fs.mkdirSync(cfg.dir.browser, { recursive: true });
if (!fs.existsSync(cfg.dir.screenshots)) fs.mkdirSync(cfg.dir.screenshots, { recursive: true });
if (!fs.existsSync(path.join(cfg.dir.screenshots, 'epic-games'))) fs.mkdirSync(path.join(cfg.dir.screenshots, 'epic-games'), { recursive: true });

(async () => {
    console.log(datetime(), '▶ Starting Epic Games Claimer process...');
    console.log('▶ Initializing local database...');
    const db = await jsonDb('epic-games.json', {});

    const browserPrefs = path.join(cfg.dir.browser, 'prefs.js');
    if (existsSync(browserPrefs)) {
      console.log('Adding webgl.disabled to', browserPrefs);
      appendFileSync(browserPrefs, 'user_pref("webgl.disabled", true);\n'); 
    } else {
      console.log(browserPrefs, 'does not exist yet, will patch it on next run.');
    }

    if (cfg.flaresolverr_url) {
      console.log(`[FlareSolverr] Active via ${cfg.flaresolverr_url}`);
    }

    console.log('▶ Starting Firefox browser (Mode: ' + (cfg.headless ? 'Headless/Invisible' : 'Visible') + ')...');
    const context = await firefox.launchPersistentContext(cfg.dir.browser, {
      headless: cfg.headless,
      viewport: { width: cfg.width, height: cfg.height },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0', 
      locale: 'en-US', 
      handleSIGINT: false, 
      args: [],
    });

    console.log('▶ Browser launched successfully. Applying anti-detection patches...');
    handleSIGINT(context);
    await stealth(context);
    if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);

    const page = context.pages().length ? context.pages()[0] : await context.newPage(); 
    await page.setViewportSize({ width: cfg.width, height: cfg.height }); 

    const liveMonitor = setInterval(async () => {
        try {
            if (page && !page.isClosed()) {
                await page.screenshot({ path: resolve(cfg.dir.screenshots, 'latest.jpg'), type: 'jpeg', quality: 50 });
            }
        } catch (e) {}
    }, 2000);

    const notify_games = [];
    let user = cfg.eg_email || 'unknown';

    try {
      await context.addCookies([
        { name: 'OptanonAlertBoxClosed', value: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), domain: '.epicgames.com', path: '/' }, 
        { name: 'HasAcceptedAgeGates', value: 'USK:9007199254740991,general:18,EPIC SUGGESTED RATING:18', domain: 'store.epicgames.com', path: '/' }, 
      ]);

      console.log('▶ Navigating to Epic Games free games page...');
      await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' }); 

      while (await page.locator('egs-navigation').getAttribute('isloggedin') != 'true') {
        console.log('⚠ Account not logged in. Redirecting to login page...');
        if (!cfg.debug) context.setDefaultTimeout(cfg.login_timeout); 
        await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
        
        if (!cfg.eg_email || !cfg.eg_password) {
            throw new Error("Missing email or password in config.json");
        }
        
        console.log('▶ Injecting credentials (Email & Password)...');
        
        page.waitForSelector('.h_captcha_challenge iframe').then(async () => {
            console.log('❌ CAPTCHA detected! Action required.');
            await notify('epic-games: got captcha during login. Please check the Live Monitor on your Dashboard to solve it manually.');
        }).catch(_ => { });
        
        await page.fill('#email', cfg.eg_email);
        await page.fill('#password', cfg.eg_password);
        await page.click('button[type="submit"]');
        
        const error = page.locator('#form-error-message');
        error.waitFor({ timeout: 5000 }).then(async () => {
            console.error('Login error:', await error.innerText());
        }).catch(_ => { });
        
        page.waitForURL('**/id/login/mfa**', { timeout: 300000 }).then(async () => {
            console.log('▶ Two-Factor Authentication (2FA) requested...');
            if (!cfg.eg_otpkey) throw new Error("MFA required but no OTP key in config");
            console.log('▶ Generating and submitting 2FA code...');
            const otp = authenticator.generate(cfg.eg_otpkey);
            await page.locator('input[name="code-input-0"]').pressSequentially(otp.toString());
            await page.click('button[type="submit"]');
        }).catch(_ => { });
        
        console.log("⏳ Waiting for login validation (Max: 5 minutes)...");
        await page.waitForURL('**/free-games**', { timeout: 300000 });
        console.log('✔ Login successfully validated!');
        if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);
      }
      
      const navUser = await page.locator('egs-navigation').getAttribute('displayname'); 
      if (navUser) user = navUser;
      console.log(`✔ Identified as: ${user}`);
      db.data[user] ||= {};

      console.log('▶ Searching for "Free Now" games...');
      const game_loc = page.locator('a:has(span:text-is("Free Now")), a:has(span:text-is("Gratuit maintenant"))');
      await game_loc.last().waitFor().catch(_ => {
        console.log('⚠ No free games found on the page.');
      });
      
      const urlSlugs = await Promise.all((await game_loc.elementHandles()).map(a => a.getAttribute('href')));
      const urls = urlSlugs.map(s => 'https://store.epicgames.com' + s);
      console.log(`▶ ${urls.length} free game(s) detected.`);

      for (const url of urls) {
        try {
          console.log(`▶ Analyzing game page: ${url.split('/').pop()}...`);
          await page.goto(url); 
        try {
          await page.waitForSelector('button[data-testid="purchase-cta-button"], button:has-text("Continue"), button:has-text("Continuer")', { timeout: 15000 });
          if (await page.locator('button:has-text("Continue"), button:has-text("Continuer")').count() > 0) {
            console.log('▶ Mature content warning (18+). Bypassing...');
            await page.click('button:has-text("Continue"), button:has-text("Continuer")', { delay: 111 });
            await page.waitForTimeout(2000);
          }
        } catch (e) {
          // Normal timeout if no mature warning
        }

        const purchaseBtn = page.locator('button[data-testid="purchase-cta-button"]').first(); 
        await purchaseBtn.waitFor({ timeout: 15000 });
        const btnText = (await purchaseBtn.innerText()).toLowerCase(); 

        let title = await page.locator('h1').first().innerText();
        let coverUrl = await page.locator('meta[property="og:image"]').getAttribute('content').catch(()=>null);
        let desc = await page.locator('meta[property="og:description"]').getAttribute('content').catch(()=>null);
        if (!desc) desc = await page.locator('meta[name="description"]').getAttribute('content').catch(()=>null);
        
        let originalPrice = '???';
        let currentPrice = 'Free';
        try {
            const priceText = await page.locator('[data-component="Price"]').first().innerText();
            const parts = priceText.split('\n').map(s => s.trim()).filter(s => s);
            if (parts.length >= 2) {
                originalPrice = parts[parts.length - 2];
                currentPrice = parts[parts.length - 1];
            } else if (parts.length === 1) {
                originalPrice = parts[0];
                currentPrice = parts[0];
            }
        } catch(e) {}
        
        const game_id = page.url().split('/').pop();
        const existedInDb = !!(db.data[user] && db.data[user][game_id]);
        db.data[user] ||= {};
        db.data[user][game_id] ||= { title, time: datetime(), url: page.url() }; 
        db.data[user][game_id].coverUrl = coverUrl; // always update images
        db.data[user][game_id].desc = desc;
        console.log(`🎮 Current game: ${chalk.cyan(title)}`);
        
        const notify_game = { title, url, status: 'failed', coverUrl, desc, originalPrice, currentPrice, isNew: !existedInDb };
        notify_games.push(notify_game); 

        if (btnText.includes('in library') || btnText.includes('dans la bibliothèque')) {
          console.log('✔ This game is already in the library.');
          notify_game.status = 'existed';
          db.data[user][game_id].status ||= 'existed'; 
        } else if (btnText.includes('requires base game') || btnText.includes('jeu de base requis')) {
          console.log('⚠ Base game required. Cannot claim this free DLC.');
          notify_game.status = 'requires base game';
          db.data[user][game_id].status ||= 'failed:requires-base-game';
        } else { 
          console.log('▶ Game not in library. Starting checkout procedure...');
          await purchaseBtn.click({ delay: 11 }); 

          page.click('button:has-text("Continue"), button:has-text("Continuer")').catch(_ => { }); 
          page.click('button:has-text("Yes, buy now"), button:has-text("Oui, acheter maintenant")').catch(_ => { }); 

          page.locator(':has-text("end user license agreement"), :has-text("contrat de licence")').waitFor().then(async () => {
            console.log('▶ Accepting End User License Agreement (EULA)...');
            await page.locator('input#agree').check(); 
            await page.locator('button:has-text("Accept"), button:has-text("Accepter")').click();
          }).catch(_ => { });

          await page.waitForSelector('#webPurchaseContainer iframe'); 
          console.log('▶ Loading payment module...');
          const iframe = page.frameLocator('#webPurchaseContainer iframe');
          
          iframe.locator('.payment-pin-code').waitFor().then(async () => {
            if (!cfg.eg_parentalpin) {
              console.log('⚠ Parental PIN requested but no code is configured!');
            } else {
              console.log('▶ Submitting Parental PIN...');
              await iframe.locator('input.payment-pin-code__input').first().pressSequentially(cfg.eg_parentalpin);
              await iframe.locator('button:has-text("Continue")').click({ delay: 11 });
            }
          }).catch(_ => { });

          console.log('▶ Finalizing free order validation...');
          await iframe.locator('button:has-text("Place Order"), button:has-text("Confirmer la commande"), button:has-text("Passer la commande"), button:has-text("Add to library"), button:has-text("Ajouter à la bibliothèque"):not(:has(.payment-loading--loading))').click({ delay: 11 });

          const btnAgree = iframe.locator('button:has-text("I Accept"), button:has-text("J\'accepte")');
          btnAgree.waitFor().then(() => btnAgree.click()).catch(_ => { }); 
          
            try {
            await Promise.race([
                page.locator('text=Thanks, text=Merci, text=Thank you, text=Order confirmed').waitFor({ state: 'attached', timeout: 30000 }),
                page.waitForSelector('#webPurchaseContainer iframe', { state: 'hidden', timeout: 30000 })
            ]);
            db.data[user][game_id].status = 'claimed';
            db.data[user][game_id].time = datetime(); 
            console.log(`✅ Success! ${title} has been added to your library.`);
          } catch (e) {
            console.log(`❌ Failed to claim ${title}.`);
            db.data[user][game_id].status = 'failed';
          }
          notify_game.status = db.data[user][game_id].status; 
        }
        
        } catch (gameError) {
          console.error(`Erreur lors du traitement du jeu ${url}:`, gameError.message);
          notify_games.push({ title: "Jeu Inconnu", url, status: `failed: ${gameError.message}`, isNew: true });
        }
      }
    } catch (error) {
      process.exitCode ||= 1;
      console.error('--- Exception:');
      console.error(error.message); 
      notify(`epic-games failed: ${error.message}`);
    } finally {
      await db.write(); 
      const games_to_notify = notify_games.filter(g => g.isNew || g.status === 'claimed' || g.status.startsWith('failed'));
      if (games_to_notify.length) { 
        const embeds = games_to_notify.map(g => {
            let color = 16776960; // Yellow for existed
            let statusText = 'Déjà dans la bibliothèque';
            if (g.status === 'claimed') { color = 3066993; statusText = 'Réclamé avec succès'; }
            if (g.status === 'failed' || g.status.startsWith('failed:')) { color = 15158332; statusText = 'Échec de récupération'; }
            
            return {
                title: g.title,
                url: g.url,
                description: `**Statut :** ${statusText}\n\n${g.desc || ''}`,
                color: color,
                image: g.coverUrl ? { url: g.coverUrl } : undefined,
                fields: [
                    { name: 'Prix d\'origine', value: `~~${g.originalPrice}~~`, inline: true },
                    { name: 'Prix actuel', value: g.currentPrice, inline: true }
                ]
            };
        });
        await notify(`🎮 Récapitulatif Epic Games pour **${user}**`, embeds);
      }
      clearInterval(liveMonitor);
    }
    await context.close();
})();
