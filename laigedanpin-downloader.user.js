// ==UserScript==
// @name         来个单品网 小说下载器 (laigedanpin)
// @namespace    https://github.com/20855za
// @version      1.0.0
// @description  在 laigedanpin1.com 的书籍页添加「下载全书 TXT」按钮，一键把整本小说存成 txt（可直接拖进「词沉浸」App 阅读）
// @author       cien
// @match        *://www.laigedanpin1.com/*
// @match        *://laigedanpin1.com/*
// @match        *://m.laigedanpin1.com/*
// @connect      laigedanpin1.com
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ORIGIN = location.origin;

  // 从当前网址里取出书号：/shu/123/ 或 /index/123/
  function getBookId() {
    const m = location.pathname.match(/\/(?:shu|index)\/(\d+)\//);
    return m ? m[1] : null;
  }

  // 用 GM_xmlhttpRequest 取页面（绕过跨域限制）
  function gmGet(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9' },
        onload: (r) => {
          if (r.status >= 200 && r.status < 300) resolve(r.responseText);
          else reject(new Error('HTTP ' + r.status + ' @ ' + url));
        },
        onerror: (e) => reject(new Error('网络错误 @ ' + url)),
        ontimeout: () => reject(new Error('超时 @ ' + url)),
      });
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 取完整章节列表（来自 /index/{id}/ 目录页）
  async function getChapterList(bookId) {
    const html = await gmGet(ORIGIN + '/index/' + bookId + '/');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a[href*="/shu/' + bookId + '/"]'))
      .map((a) => a.getAttribute('href'))
      .filter((h) => /^\/shu\/\d+\/\d+\.html$/.test(h));
    const seen = new Set();
    const out = [];
    for (const h of links) {
      if (!seen.has(h)) {
        seen.add(h);
        out.push(h);
      }
    }
    return out;
  }

  // 取单章正文（#content）
  async function getChapterText(chapPath) {
    const html = await gmGet(ORIGIN + chapPath);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const c = doc.querySelector('#content');
    if (!c) return '';
    c.querySelectorAll('script,style,ins,iframe').forEach((e) => e.remove());
    let txt = c.innerText.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    return txt;
  }

  // 书名 / 作者
  function getBookMeta() {
    const h1 = document.querySelector('h1.book a, h1.book');
    let bookname = h1 ? h1.innerText.trim() : '';
    if (!bookname) bookname = (document.title || 'novel').split('_')[0].trim();
    const m = document.title.match(/([\u4e00-\u9fa5A-Za-z0-9]+)小说作品/);
    const author = m ? m[1] : '';
    return { bookname: bookname.replace(/[\\/:*?"<>|]/g, ''), author };
  }

  // ---------- UI ----------
  let bar, statusEl, btn;
  function buildUI() {
    if (document.getElementById('lgdl-bar')) return;
    bar = document.createElement('div');
    bar.id = 'lgdl-bar';
    bar.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;' +
      'background:#222;color:#fff;padding:10px 12px;border-radius:10px;' +
      'font:14px/1.4 sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4);display:flex;' +
      'align-items:center;gap:10px;';
    btn = document.createElement('button');
    btn.textContent = '下载全书 TXT';
    btn.style.cssText =
      'background:#2ecc71;color:#fff;border:0;border-radius:8px;padding:8px 14px;' +
      'font-size:14px;font-weight:700;white-space:nowrap;';
    statusEl = document.createElement('span');
    statusEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.9;';
    statusEl.textContent = '点击右侧按钮下载整本小说';
    bar.appendChild(btn);
    bar.appendChild(statusEl);
    document.body.appendChild(bar);
    btn.addEventListener('click', start);
  }

  function setStatus(t) {
    if (statusEl) statusEl.textContent = t;
  }

  async function start() {
    const bookId = getBookId();
    if (!bookId) {
      setStatus('当前页面不是书籍页（请打开 /shu/数字/ 页面）');
      return;
    }
    btn.disabled = true;
    try {
      const { bookname, author } = getBookMeta();
      setStatus('正在获取目录…');
      const list = await getChapterList(bookId);
      if (!list.length) {
        setStatus('没找到章节，可能该书无目录页');
        btn.disabled = false;
        return;
      }
      setStatus('共 ' + list.length + ' 章，开始下载…');
      let txt = (bookname + (author ? '（' + author + '）' : '')) + '\n\n';
      for (let i = 0; i < list.length; i++) {
        setStatus('下载中 ' + (i + 1) + '/' + list.length);
        try {
          const t = await getChapterText(list[i]);
          txt += '\n\n' + t;
        } catch (e) {
          txt += '\n\n【第 ' + (i + 1) + ' 章下载失败：' + e.message + '】';
        }
        if (i % 5 === 4) await sleep(250); // 轻微限速，避免被封
      }
      setStatus('下载完成，正在保存…');
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const fname = bookname + '.txt';
      GM_download({
        url: url,
        name: fname,
        saveAs: true,
        onerror: (err) => {
          // 回退：用普通 <a> 下载
          const a = document.createElement('a');
          a.href = url;
          a.download = fname;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setStatus('已尝试保存 ' + fname);
        },
      });
      setStatus('✅ 完成！文件：' + fname + '（可拖进「词沉浸」App）');
    } catch (e) {
      setStatus('出错：' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- 启动 ----------
  function init() {
    if (getBookId()) buildUI();
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else window.addEventListener('DOMContentLoaded', init);
})();
