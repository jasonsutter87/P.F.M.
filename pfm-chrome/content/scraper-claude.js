/* ================================================================
   Claude DOM Scraper
   Targets: claude.ai
   ================================================================ */
const ScraperClaude = {
  platform: 'claude',

  /**
   * CSS selector fallbacks — ordered by likelihood of matching.
   * Claude.ai uses Tailwind utility classes; the custom font-family
   * classes (.font-user-message / .font-claude-message) have been
   * the most stable identifiers across UI updates.
   */
  selectors: {
    userTurn: [
      '.font-user-message',
      '[data-testid="user-message"]',
      '[data-testid="human-turn"]',
      '[class*="human-turn"]',
      '[class*="user-message"]',
      '[class*="UserMessage"]'
    ],
    assistantTurn: [
      '.font-claude-message',
      '[data-testid="assistant-turn"]',
      '[class*="assistant-turn"]',
      '[class*="claude-message"]',
      '[class*="AssistantMessage"]'
    ],
    userContent: [
      '[data-testid="user-message"]',
      '.whitespace-pre-wrap',
      'p',
      'div'
    ],
    assistantContent: [
      '.grid-cols-1',
      '.prose',
      '[class*="markdown"]',
      'div[class*="grid"]',
      'div'
    ],
    conversationTitle: [
      '[data-testid="chat-title-button"]',
      'button[data-testid="chat-title"]',
      '[data-testid="chat-menu-trigger"]',
      'h2',
      '[class*="ConversationTitle"]'
    ],
    modelBadge: [
      '[data-testid="model-selector"]',
      'button[class*="model"]',
      '[class*="ModelBadge"]',
      '[class*="model-selector"]'
    ]
  },

  /** Try multiple selectors against parent; return first hit */
  query(parent, selectorList, all) {
    for (const sel of selectorList) {
      try {
        const result = all ? parent.querySelectorAll(sel) : parent.querySelector(sel);
        if (all ? result.length > 0 : result) return result;
      } catch (_) { /* invalid selector, skip */ }
    }
    return all ? [] : null;
  },

  MAX_CONTENT_SIZE: 10 * 1024 * 1024,
  MAX_MESSAGES: 5000,

  detect() {
    return location.hostname === 'claude.ai';
  },

  scrape() {
    const messages = [];
    let totalSize = 0;

    // ----------------------------------------------------------
    // Strategy 1: .font-user-message / .font-claude-message
    // These Tailwind utility classes are the most reliable
    // identifiers on the current Claude.ai UI.
    // ----------------------------------------------------------
    const userTurns = this.query(document, this.selectors.userTurn, true);
    const assistantTurns = this.query(document, this.selectors.assistantTurn, true);

    if (userTurns.length > 0 || assistantTurns.length > 0) {
      const allTurns = [];

      for (const el of userTurns) {
        const content = this.query(el, this.selectors.userContent, false);
        const text = (content || el).innerText.trim();
        if (text) allTurns.push({ el, role: 'user', content: text });
      }

      for (const el of assistantTurns) {
        const content = this.query(el, this.selectors.assistantContent, false);
        const text = (content || el).innerText.trim();
        if (text) allTurns.push({ el, role: 'assistant', content: text });
      }

      // Sort by DOM position
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
    // Strategy 2: data-testid based selectors
    // Older/alternate Claude UI variants use data-testid attrs.
    // ----------------------------------------------------------
    if (messages.length === 0) {
      const testIdTurns = document.querySelectorAll(
        '[data-testid="conversation-turn"], [data-testid*="turn"]'
      );
      if (testIdTurns.length > 0) {
        for (const turn of testIdTurns) {
          if (messages.length >= this.MAX_MESSAGES) break;
          const isUser = turn.matches('[data-testid*="human"], [data-testid*="user"]') ||
                         !!turn.querySelector('[data-testid*="human"], [data-testid*="user"]');
          const text = turn.innerText.trim();
          if (text) {
            totalSize += text.length;
            if (totalSize > this.MAX_CONTENT_SIZE) break;
            messages.push({ role: isUser ? 'user' : 'assistant', content: text });
          }
        }
      }
    }

    // ----------------------------------------------------------
    // Strategy 3: Walk the main content area looking for message
    // blocks by structural patterns (last resort).
    // ----------------------------------------------------------
    if (messages.length === 0) {
      // Look for the main scrollable conversation container
      const candidates = document.querySelectorAll(
        'main [class*="flex"][class*="col"], [role="main"] [class*="flex"][class*="col"], [class*="conversation"] > div'
      );
      for (const container of candidates) {
        const children = container.children;
        if (children.length < 2) continue;
        let isUser = true;
        for (const child of children) {
          if (messages.length >= this.MAX_MESSAGES) break;
          const text = child.innerText.trim();
          if (text && text.length > 1) {
            totalSize += text.length;
            if (totalSize > this.MAX_CONTENT_SIZE) break;
            messages.push({ role: isUser ? 'user' : 'assistant', content: text });
            isUser = !isUser;
          }
        }
        if (messages.length > 0) break;
      }
    }

    if (messages.length === 0) return null;

    // Title
    let title = 'Claude Conversation';
    const titleEl = this.query(document, this.selectors.conversationTitle, false);
    if (titleEl) {
      // The title button often has nested elements; grab deepest text
      const truncEl = titleEl.querySelector('.truncate') || titleEl;
      const t = truncEl.innerText.trim();
      if (t && t.length > 0 && t.length < 200) title = t;
    }

    // Model
    let model = 'claude';
    const modelEl = this.query(document, this.selectors.modelBadge, false);
    if (modelEl) {
      const m = modelEl.innerText.trim().toLowerCase();
      if (m && m.length < 50) model = m;
    }

    return { messages, title, model, platform: this.platform };
  }
};
