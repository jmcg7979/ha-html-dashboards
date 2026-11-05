import { chromium } from 'playwright';
const b=await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p=await b.newPage({viewport:{width:1280,height:800}}); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(['error','warning'].includes(m.type()))errs.push(m.text().slice(0,200))});
await p.goto('http://localhost:8125/local/dash/index.html?d=main'); await p.evaluate(()=>localStorage.setItem('hassTokens',JSON.stringify({hassUrl:location.origin,refresh_token:'R',access_token:'A',expires:Date.now()+1e6,clientId:location.origin+'/'})));
await p.reload(); await p.waitForTimeout(2500);
await p.screenshot({path:'./shot_home.png'});
console.log('scrollH', await p.evaluate(()=>document.documentElement.scrollHeight));
for (const id of (process.argv[2] || 'lights,timers,vacuum').split(',')) { await p.evaluate((i)=>location.hash=i,id); await p.waitForTimeout(900); await p.screenshot({path:`./shot_${id}.png`}); }
console.log('ERR', errs); await b.close();
