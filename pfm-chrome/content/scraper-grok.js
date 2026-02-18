/* ================================================================
   Grok DOM Scraper
   Targets: grok.com, x.com/i/grok, grok.x.ai
   ================================================================
   Grok uses a Tailwind CSS UI that changes frequently.
   This scraper uses multiple strategies and avoids relying
   on a single set of class names.
   ================================================================ */
const ScraperGrok = {
  platform: 'grok',

  selectors: {
    userMessage: [
      '[class*="bg-surface-l1"]',
      '.user-message',
      '[data-message-type="user"]',
      '[class*="user-query"]',
      '[class*="UserMessage"]'
    ],
    assistantMessage: [
      '.response-content-markdown',
      '.message-bubble:not([class*="bg-surface-l1"])',
      '[data-message-type="model"]',
      '[class*="model-response"]',
      '[class*="AssistantMessage"]',
      '[class*="markdown"]'
    ],
    messageBlock: [
      '.message-bubble',
      '[class*="message-content"]',
      '[class*="chat-message"]',
      '[class*="turn"]'
    ],
    conversationTitle: [
      '.conversation-title',
      'h1',
      '[data-testid="conversation-title"]',
      'title'
    ],
    modelName: [
      '.model-selector',
      '[data-model-name]',
      'button[aria-label*="model"]',
      '[class*="model-badge"]'
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
    if (host === 'grok.com' || host === 'grok.x.ai') return true;
    if (host === 'x.com' && location.pathname.startsWith('/i/grok')) return true;
    return false;
  },

  scrape() {
    const messages = [];
    let totalSize = 0;

    // ----------------------------------------------------------
    // Strategy 1: Explicit user/assistant selectors
    // ----------------------------------------------------------
    const userEls = this.query(document, this.selectors.userMessage, true);
    const assistantEls = this.query(document, this.selectors.assistantMessage, true);

    if (userEls.length > 0 || assistantEls.length > 0) {
      const allTurns = [];

      for (const el of userEls) {
        const text = el.innerText.trim();
        if (text) allTurns.push({ el, role: 'user', content: text });
      }

      for (const el of assistantEls) {
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
    // Strategy 2: Generic message blocks with role inference
    // Grok's Tailwind DOM changes often; fall back to finding
    // the central conversation column and walking its children.
    // ----------------------------------------------------------
    if (messages.length === 0) {
      const blocks = this.query(document, this.selectors.messageBlock, true);
      if (blocks.length > 0) {
        let isUser = true;
        for (const block of blocks) {
          if (messages.length >= this.MAX_MESSAGES) break;
          const text = block.innerText.trim();
          if (text && text.length > 1) {
            // Heuristic: user messages tend to be shorter
            // and lack markdown formatting
            const looksLikeAssistant = text.length > 200 ||
                                       text.includes('```') ||
                                       text.includes('**') ||
                                       (text.match(/\n/g) || []).length > 5;
            const role = looksLikeAssistant ? 'assistant' : 'user';
            totalSize += text.length;
            if (totalSize > this.MAX_CONTENT_SIZE) break;
            messages.push({ role, content: text });
          }
        }
      }
    }

    // ----------------------------------------------------------
    // Strategy 3: Walk the main flex column container
    // ----------------------------------------------------------
    if (messages.length === 0) {
      const mainCol = document.querySelector(
        'main [class*="flex"][class*="col"], [class*="flex"][class*="col"][class*="gap"]'
      );
      if (mainCol) {
        let isUser = true;
        for (const child of mainCol.children) {
          if (messages.length >= this.MAX_MESSAGES) break;
          const text = child.innerText.trim();
          if (text && text.length > 1) {
            totalSize += text.length;
            if (totalSize > this.MAX_CONTENT_SIZE) break;
            messages.push({ role: isUser ? 'user' : 'assistant', content: text });
            isUser = !isUser;
          }
        }
      }
    }

    if (messages.length === 0) return null;

    // Title
    let title = 'Grok Conversation';
    const titleEl = this.query(document, this.selectors.conversationTitle, false);
    if (titleEl) {
      const t = titleEl.innerText.trim();
      if (t && t.length > 0 && t.length < 200 && t !== 'Grok') title = t;
    }

    // Model
    let model = 'grok';
    const modelEl = this.query(document, this.selectors.modelName, false);
    if (modelEl) {
      const m = modelEl.innerText.trim().toLowerCase();
      if (m && m.length < 50) model = m;
    }

    return { messages, title, model, platform: this.platform };
  }
};
