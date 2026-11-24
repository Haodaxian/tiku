#!/usr/bin/env node
/** 视觉验收：逐页截图（轻量，不调模型） */
const path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.e2e', 'shots');
const BASE = 'http://127.0.0.1:7788';

const views = (process.argv[2] || 'dashboard,record,import,bank,lecture,stats,settings').split(',');
const DARK = process.argv.indexOf('--dark') > 0;

(async () => {
  const b = await launch({
    port: 9400 + Math.floor(Math.random() * 90),
    // 每次用独立配置目录：复用同一个 user-data-dir 时，
    // 残留的浏览器进程会占住单例锁，新实例直接退出，表现为脚本无输出
    profile: path.join(ROOT, '.e2e', 'profile-' + Date.now())
  });
  const cdp = b.cdp;
  try {
    for (const v of views) {
      await cdp.goto(BASE + '/?view=' + v, 2200);
      if (DARK) {
        await cdp.eval('localStorage.setItem("tiku-theme","dark");document.documentElement.classList.add("dark");return true;');
        await sleep(600);
      }
      await sleep(700);
      await cdp.screenshot(path.join(OUT, 'ui-' + v + (DARK ? '-dark' : '') + '.png'));
      const errs = cdp.pageErrors.filter((e) => !/favicon/i.test(e));
      console.log('已截图', v, errs.length ? '｜报错：' + errs[0].slice(0, 160) : '');
      cdp.clearLog();
    }
  } catch (e) {
    console.error('失败:', e.message);
  } finally {
    await b.close();
  }
})();
