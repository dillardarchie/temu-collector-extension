/**
 * content.js - Temu批量采集助手 页面脚本
 * 功能：智能查找并点击妙手ERP的"采集此商品"按钮
 */

(function () {
  'use strict';

  // 防止重复注入
  if (window.__temuCollectorInjected) return;
  window.__temuCollectorInjected = true;

  const MAX_RETRIES = 5;
  const RETRY_INTERVAL = 600;

  /**
   * 清除文本中的不可见字符/特殊字符（妙手会在文字中插入 @zwmj; 等水印字符）
   * 保留中文、英文、数字
   */
  function cleanText(str) {
    return (str || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').trim();
  }

  /**
   * 判断文本是否匹配采集关键词（清除特殊字符后匹配）
   */
  function isCollectText(rawText) {
    const clean = cleanText(rawText);
    return clean === '采集此商品' ||
           clean === '采集商品' ||
           clean === '采集' ||
           clean.startsWith('采集此商品') ||
           clean.startsWith('采集商品');
  }

  // ============================================================
  // 核心：全量 DOM 扫描（包括 Shadow DOM + iframe）
  // ============================================================

  /**
   * 递归遍历所有 shadow root，收集所有节点
   */
  function* walkAllNodes(root) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      null,
      false
    );
    let node = walker.currentNode;
    while (node) {
      yield node;
      if (node.shadowRoot) {
        yield* walkAllNodes(node.shadowRoot);
      }
      node = walker.nextNode();
    }
  }

  /**
   * 获取元素的可见文本（只取直接文本节点）
   */
  function getDirectText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text.trim();
  }

  /**
   * 获取元素的完整文本（包含子元素）
   */
  function getFullText(el) {
    return (el.innerText || el.textContent || '').trim();
  }

  /**
   * 清理后的完整文本（去除特殊水印字符）
   */
  function getCleanText(el) {
    return cleanText(getFullText(el));
  }

  /**
   * 判断元素是否可见
   */
  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  /**
   * 向上查找最近的 earth-wxt-button 祖先（妙手自定义组件）
   */
  function findEarthWxtButtonAncestor(el) {
    let cur = el;
    while (cur) {
      if (cur.tagName && cur.tagName.toLowerCase() === 'earth-wxt-button') {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  /**
   * 主查找函数：遍历所有 DOM（包含 shadow root）
   * 策略：找到文字后，向上冒泡到 earth-wxt-button 再点击
   */
  function findCollectButton() {
    // ── 策略1：直接用 CSS 选择器找 earth-wxt-button（最快）──
    const earthBtns = document.querySelectorAll('earth-wxt-button');
    for (const btn of earthBtns) {
      const text = getCleanText(btn);
      if (isCollectText(text)) {
        if (isVisible(btn)) {
          console.log('[Temu采集助手] 策略1 找到 earth-wxt-button:', text);
          return btn;
        }
      }
    }

    // ── 策略2：查找包含采集文字的 span，向上找 earth-wxt-button ──
    const allSpans = document.querySelectorAll('span');
    for (const span of allSpans) {
      const text = getCleanText(span);
      if (isCollectText(text)) {
        // 向上找 earth-wxt-button
        const btn = findEarthWxtButtonAncestor(span);
        if (btn && isVisible(btn)) {
          console.log('[Temu采集助手] 策略2 通过span找到 earth-wxt-button:', text);
          return btn;
        }
        // 找不到 earth-wxt-button，向上找可点击的父级
        let cur = span.parentElement;
        while (cur && cur !== document.body) {
          const tag = cur.tagName.toLowerCase();
          const role = cur.getAttribute('role');
          if (tag === 'button' || tag === 'a' || role === 'button') {
            if (isVisible(cur)) {
              console.log('[Temu采集助手] 策略2 通过span找到父级按钮:', tag, text);
              return cur;
            }
          }
          cur = cur.parentElement;
        }
        // 最后尝试直接点 span
        if (isVisible(span)) {
          console.log('[Temu采集助手] 策略2 直接使用span:', text);
          return span;
        }
      }
    }

    // ── 策略3：遍历所有节点（含 shadow DOM）──
    for (const el of walkAllNodes(document.body || document.documentElement)) {
      const text = getCleanText(el);
      const directText = cleanText(getDirectText(el));

      if (isCollectText(text) || isCollectText(directText)) {
        if (isVisible(el)) {
          // 如果是文字节点容器，向上找 earth-wxt-button
          const ancestor = findEarthWxtButtonAncestor(el);
          if (ancestor && isVisible(ancestor)) {
            console.log('[Temu采集助手] 策略3 找到祖先 earth-wxt-button:', el.tagName, '|', text);
            return ancestor;
          }
          console.log('[Temu采集助手] 策略3 找到按钮:', el.tagName, '|', text, '| class:', el.className);
          return el;
        }
      }
    }

    // ── 策略4：搜索 iframe ──
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) continue;

        const iframeEarthBtns = doc.querySelectorAll('earth-wxt-button');
        for (const btn of iframeEarthBtns) {
          const text = getCleanText(btn);
          if (isCollectText(text) && isVisible(btn)) {
            console.log('[Temu采集助手] iframe 策略 找到 earth-wxt-button:', text);
            return btn;
          }
        }

        for (const el of walkAllNodes(doc.body || doc.documentElement)) {
          const text = getCleanText(el);
          if (isCollectText(text) && isVisible(el)) {
            console.log('[Temu采集助手] iframe 找到按钮:', el.tagName, text);
            return el;
          }
        }
      } catch (e) {
        // 跨域
      }
    }

    return null;
  }

  /**
   * 收集调试信息：所有包含"采集"的元素
   */
  function debugCollectAll() {
    const results = [];

    for (const el of walkAllNodes(document.body || document.documentElement)) {
      const rawText = getFullText(el);
      const cleanedText = cleanText(rawText);
      if (cleanedText.includes('采集') || rawText.includes('采集')) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        results.push({
          tag: el.tagName,
          id: el.id,
          className: (el.className || '').toString().substring(0, 80),
          rawText: rawText.substring(0, 50),
          cleanText: cleanedText.substring(0, 50),
          directText: getDirectText(el),
          visible: isVisible(el),
          rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
          position: style.position,
          zIndex: style.zIndex,
          bgColor: style.backgroundColor,
          cursor: style.cursor,
          inShadow: el.getRootNode() !== document ? 'YES' : 'no',
        });
      }
    }

    // 搜索 iframes
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((iframe, idx) => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        for (const el of walkAllNodes(doc.body || doc.documentElement)) {
          const rawText = getFullText(el);
          if (cleanText(rawText).includes('采集') || rawText.includes('采集')) {
            results.push({
              tag: `[iframe${idx}] ${el.tagName}`,
              id: el.id,
              className: (el.className || '').toString().substring(0, 80),
              rawText: rawText.substring(0, 50),
              cleanText: cleanText(rawText).substring(0, 50),
              visible: isVisible(el),
            });
          }
        }
      } catch (e) {}
    });

    return results;
  }

  /**
   * 触发标准 MouseEvent（带 bubbles）
   */
  function fireMouseEvents(el) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach((type) => {
      el.dispatchEvent(new MouseEvent(type, {
        view: window,
        bubbles: true,
        cancelable: true,
        buttons: 1,
        button: 0,
        clientX: cx,
        clientY: cy,
        screenX: cx,
        screenY: cy,
      }));
    });
  }

  /**
   * 模拟点击按钮（多方式，针对 earth-wxt-button 自定义组件优化）
   */
  function clickButton(button) {
    if (!button) return false;

    try {
      // 滚动到视野内
      button.scrollIntoView({ behavior: 'instant', block: 'center' });

      const tag = button.tagName ? button.tagName.toLowerCase() : '';

      // 如果是 earth-wxt-button 自定义组件，尝试多种点击方式
      if (tag === 'earth-wxt-button') {
        console.log('[Temu采集助手] 点击 earth-wxt-button 组件');

        // 方式1：直接 click
        button.click();
        fireMouseEvents(button);

        // 方式2：找内部真实的 button/span 元素点击
        const innerBtn = button.querySelector('button') ||
                         button.querySelector('[role="button"]') ||
                         button.querySelector('span');
        if (innerBtn) {
          innerBtn.click();
          fireMouseEvents(innerBtn);
          console.log('[Temu采集助手] 同时点击内部元素:', innerBtn.tagName);
        }

        // 方式3：如果有 shadow root，找里面的按钮
        if (button.shadowRoot) {
          const shadowBtn = button.shadowRoot.querySelector('button') ||
                           button.shadowRoot.querySelector('[role="button"]');
          if (shadowBtn) {
            shadowBtn.click();
            fireMouseEvents(shadowBtn);
            console.log('[Temu采集助手] 点击 shadow root 内按钮');
          }
        }

        return true;
      }

      // 普通元素点击
      button.click();
      fireMouseEvents(button);

      return true;
    } catch (e) {
      console.error('[Temu采集助手] 点击失败:', e);
      return false;
    }
  }

  /**
   * 等待顶部成功提示出现（妙手成功后会在顶部显示绿色提示条）
   * 文字包含"已提交采集任务"等
   */
  async function waitForSuccess(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const el of walkAllNodes(document.body || document.documentElement)) {
        const text = cleanText(getFullText(el));
        if (
          text.includes('已提交采集') ||
          text.includes('采集成功') ||
          text.includes('已添加') ||
          text.includes('前往采集箱') ||
          text.includes('可前往采集箱') ||
          text.includes('采集任务提交成功')
        ) {
          if (isVisible(el)) {
            console.log('[Temu采集助手] 检测到成功提示:', text.substring(0, 50));
            return true;
          }
        }
      }
      await sleep(300);
    }
    return false;
  }

  /**
   * 执行采集（带重试）
   */
  async function executeCollect(retryCount = 0) {
    const button = findCollectButton();

    if (button) {
      const buttonText = getCleanText(button);
      console.log('[Temu采集助手] 点击按钮:', buttonText, button.tagName, button.className);

      clickButton(button);

      // 等待成功提示
      const ok = await waitForSuccess(10000);

      if (ok) {
        return { success: true, message: '采集成功！' };
      }

      // 即使没检测到提示，只要点了按钮就算成功（妙手异步处理）
      return { success: true, message: '已点击采集，妙手处理中' };
    }

    if (retryCount < MAX_RETRIES) {
      await sleep(RETRY_INTERVAL);
      return executeCollect(retryCount + 1);
    }

    return {
      success: false,
      message: '未找到采集按钮（妙手插件可能未加载）',
    };
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ============================================================
  // 消息监听
  // ============================================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'collect') {
      executeCollect()
        .then(sendResponse)
        .catch((e) => sendResponse({ success: false, message: e.message }));
      return true;
    }

    if (message.action === 'checkButton') {
      const btn = findCollectButton();
      sendResponse({ found: !!btn, text: btn ? getCleanText(btn) : '' });
      return false;
    }

    if (message.action === 'debug') {
      const btn = findCollectButton();
      const allFound = debugCollectAll();
      console.log('[Temu采集助手] 全量调试结果:', JSON.stringify(allFound, null, 2));
      sendResponse({
        found: !!btn,
        text: btn ? `${btn.tagName}: ${getCleanText(btn)}` : '',
        allElements: allFound,
        url: location.href,
      });
      return false;
    }
  });

  console.log('[Temu采集助手] Content script 已加载');
})();
