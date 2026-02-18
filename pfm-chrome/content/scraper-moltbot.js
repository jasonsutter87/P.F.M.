/* ================================================================
   Moltbot / OpenClaw DOM Scraper
   Targets: Self-hosted OpenClaw (formerly Moltbot/Clawdbot) web UI
   ================================================================
   OpenClaw is self-hosted so URLs vary (localhost, custom domains).
   Detection is based on page branding and UI component patterns
   rather than hostname alone.

   The web UI has migrated from Lit Web Components to React
   (assistant-ui) — both patterns are supported.
   ================================================================ */
const ScraperMoltbot = {
  platform: 'moltbot',

  selectors: {
    // assistant-ui React components (post-migration)
    assistantUIUser: [
      '[data-role="user"]',
      '.aui-user-message',
      '[class*="UserMessage"]'
    ],
    assistantUIAssistant: [
      '[data-role="assistant"]',
      '.aui-assistant-message',
      '[class*="AssistantMessage"]'
    ],
    // Lit-based components (pre-migration)
    litMessage: [
      'message-item',
      'chat-message',
      '[class*="message-item"]',
      '[class*="chat-message"]'
    ],
    // Generic chat patterns
    genericUser: [
      '[data-sender="user"]',
      '[data-author="user"]',
      '.user-message',
      '[class*="user"][ class*="message"]'
    ],
    genericAssistant: [
      '[data-sender="assistant"]',
      '[data-sender="agent"]',
      '[data-author="assistant"]',
      '.assistant-message',
      '.agent-message',
      '[class*="assistant"][ class*="message"]',
      '[class*="agent"][ class*="message"]'
    ],
    conversationTitle: [
      '.conversation-title',
      '[data-testid="conversation-title"]',
      'h1',
      'h2'
    ]
  },

  query(parent, selectorList, all) {
    for (const sel of selectorList) {
      try {
        const result = all ? parent.querySelectorAll(sel) : parent.querySelector(sel);
        if (all ? result.length > 0 : result) return result;
      } catch (_) { /* skip */ }
    }
    return all ? [] : null;
  },

  MAX_CONTENT_SIZE: 10 * 1024 * 1024,
  MAX_MESSAGES: 5000,

  detect() {
    const host = location.hostname;

    // Known hosted URLs
    if (host === 'openclaw.ai' || host.endsWith('.openclaw.ai')) return true;
    if (host === 'molt.bot' || host === 'moltbot.you') return true;

    // Check page content for branding signals
    const title = (document.title || '').toLowerCase();
    if (title.includes('openclaw') || title.includes('moltbot') || title.includes('clawdbot')) {
      return true;
    }

    // Check meta tags
    const generator = document.querySelector('meta[name="generator"]');
    if (generator) {
      const val = (generator.getAttribute('content') || '').toLowerCase();
      if (val.includes('openclaw') || val.includes('moltbot')) return true;
    }

    // Check for specific app identifiers in DOM
    if (document.querySelector('[data-app="openclaw"], [data-app="moltbot"], claw-chat, moltbot-chat')) {
      return true;
    }

    return false;
  },

  scrape() {
    const messages = [];
    let totalSize = 0;

    // ----------------------------------------------------------
    // Strategy 1: assistant-ui React components
    // After PR #1873 the UI migrated to assistant-ui with
    // data-role attributes on message wrappers.
    // ----------------------------------------------------------
    const auiUser = this.query(document, this.selectors.assistantUIUser, true);
    const auiAssistant = this.query(document, this.selectors.assistantUIAssistant, true);

    if (auiUser.length > 0 || auiAssistant.length > 0) {
      const allTurns = [];

      for (const el of auiUser) {
        const text = el.innerText.trim();
        if (text) allTurns.push({ el, role: 'user', content: text });
      }

      for (const el of auiAssistant) {
        const text = el.innerText.trim();
        if (text) allTurns.push({ el, role: 'assistant', content: text });
      }

      allTurns.sort((a, b) => {
        const pos = a.el.compareDocumentPosition(b.el);
        return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });

      for (const turn of allTurns) {
        if (messages.length >= this.MAX_MESSAGES) break;
        totalSize += turn.content.length;
        if (totalSize > this.MAX_CONTENT_SIZE) break;
        messages.push({ role: turn.role, content: turn.content });
      }
    }

    // ----------------------------------------------------------
    // Strategy 2: Lit Web Component custom elements
    // ----------------------------------------------------------
    if (messages.length === 0) {
      const litEls = this.query(document, this.selectors.litMessage, true);
      if (litEls.length > 0) {
        for (const el of litEls) {
          if (messages.length >= this.MAX_MESSAGES) break;
          const text = el.innerText.trim();
          if (!text) continue;
          // Determine role from attributes or class
          const sender = el.getAttribute('data-sender') ||
                         el.getAttribute('data-role') ||
                         el.getAttribute('data-author') || '';
          const cls = el.className || '';
          const isUser = sender === 'user' || cls.includes('user');
          totalSize += text.length;
          if (totalSize > this.MAX_CONTENT_SIZE) break;
          messages.push({ role: isUser ? 'user' : 'assistant', content: text });
        }
      }
    }

    // ----------------------------------------------------------
    // Strategy 3: Generic chat selectors
    // ----------------------------------------------------------
    if (messages.length === 0) {
      const genUser = this.query(document, this.selectors.genericUser, true);
      const genAssistant = this.query(document, this.selectors.genericAssistant, true);

      if (genUser.length > 0 || genAssistant.length > 0) {
        const allTurns = [];

        for (const el of genUser) {
          const text = el.innerText.trim();
          if (text) allTurns.push({ el, role: 'user', content: text });
        }

        for (const el of genAssistant) {
          const text = el.innerText.trim();
          if (text) allTurns.push({ el, role: 'assistant', content: text });
        }

        allTurns.sort((a, b) => {
          const pos = a.el.compareDocumentPosition(b.el);
          return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });

        for (const turn of allTurns) {
          if (messages.length >= this.MAX_MESSAGES) break;
          totalSize += turn.content.length;
          if (totalSize > this.MAX_CONTENT_SIZE) break;
          messages.push({ role: turn.role, content: turn.content });
        }
      }
    }

    if (messages.length === 0) return null;

    // Title
    let title = 'OpenClaw Conversation';
    const titleEl = this.query(document, this.selectors.conversationTitle, false);
    if (titleEl) {
      const t = titleEl.innerText.trim();
      if (t && t.length > 0 && t.length < 200) title = t;
    }

    return { messages, title, model: 'openclaw', platform: this.platform };
  }
};
