// ==UserScript==
// @name         ChatGPT / Claude Export to Markdown
// @namespace    http://github.com/tizee-tampermonkey-scripts/chatgpt-claude-export-markdown/
// @version      1.1.0
// @description  Copy OpenAI ChatGPT or Claude.ai conversations as Markdown, with options to open or download.
// @author       tizee
// @match        https://chatgpt.com/*
// @match        https://*.openai.com/*
// @match        https://claude.ai/*
// @match        https://*.claude.ai/*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/tizee-tampermonkey-scripts/chatgpt-claude-export-markdown/refs/heads/main/chatgpt-export-markdown.user.js
// @updateURL    https://raw.githubusercontent.com/tizee-tampermonkey-scripts/chatgpt-claude-export-markdown/refs/heads/main/chatgpt-export-markdown.user.js
// ==/UserScript==

(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // Platform detection
    // -------------------------------------------------------------------------

    function detectPlatform() {
        const host = window.location.hostname;
        if (host.includes('chatgpt.com') || host.includes('openai.com')) return 'chatgpt';
        if (host.includes('claude.ai')) return 'claude';
        return 'unknown';
    }

    // -------------------------------------------------------------------------
    // Shared utilities
    // -------------------------------------------------------------------------

    function sortByDomOrder(nodes) {
        return Array.from(nodes).sort((a, b) =>
            a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
        );
    }

    function cleanNode(node, extraSelectors = '') {
        const clone = node.cloneNode(true);
        const selectors = [
            'button',
            'svg',
            'img',
            '[hidden]',
            '[class*="button"]',
            '[class*="copy"]',
            '[class*="action"]',
            // ChatGPT: role headings ("You said:") and citation badges
            'h4[data-conversation-role]',
            '[data-d-component="badge"]',
            '[data-markdown-copy="exclude"]',
        ];
        if (extraSelectors) selectors.push(extraSelectors);
        clone.querySelectorAll(selectors.join(', ')).forEach((n) => n.remove());
        return clone;
    }

    function katexToMd(node) {
        const tex = node.querySelector('annotation[encoding="application/x-tex"]');
        const src = (tex ? tex.textContent : node.textContent || '').trim();
        return node.classList.contains('katex-display') ? `\n$$\n${src}\n$$\n` : `$${src}$`;
    }

    function listToMd(list, ordered) {
        let out = '';
        let n = 1;
        for (const li of list.children) {
            if (li.tagName.toLowerCase() !== 'li') continue;
            const inner = processContent(li);
            if (!inner) continue;
            const marker = ordered ? `${n++}. ` : '- ';
            out += marker + inner.replace(/\n+/g, '\n' + ' '.repeat(marker.length)) + '\n';
        }
        return '\n' + out + '\n';
    }

    function tableToMd(table) {
        const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
            Array.from(tr.children)
                .filter((c) => /^t[hd]$/i.test(c.tagName))
                .map((c) => processContent(c).replace(/\s*\n+\s*/g, ' ').replace(/\|/g, '\\|'))
        );
        if (rows.length === 0) return '';
        const width = Math.max(...rows.map((r) => r.length));
        const line = (r) => '| ' + Array.from({ length: width }, (_, i) => r[i] || '').join(' | ') + ' |';
        const [head, ...body] = rows;
        return (
            '\n' +
            [line(head), line(Array(width).fill('---')), ...body.map(line)].join('\n') +
            '\n\n'
        );
    }

    function processContent(node) {
        let out = '';
        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent || '';
                if (text.trim()) out += text;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toLowerCase();
                if (child.classList.contains('katex-display') || child.classList.contains('katex')) {
                    out += katexToMd(child);
                } else if (tag === 'ol' || tag === 'ul') {
                    out += listToMd(child, tag === 'ol');
                } else if (tag === 'table') {
                    out += tableToMd(child);
                } else if (child.hasAttribute('data-d-default-strong')) {
                    // ChatGPT DIL renderer marks bold text with a span attribute instead of <strong>
                    out += '**' + (child.textContent || '').trim() + '**';
                } else if (tag === 'pre') {
                    const code = child.querySelector('code');
                    if (code) {
                        const lang = (code.className.match(/language-(\w+)/) || [])[1] || '';
                        out += '\n```' + lang + '\n' + (code.textContent || '').trim() + '\n```\n';
                    } else {
                        out += '\n```\n' + (child.textContent || '').trim() + '\n```\n';
                    }
                } else if (tag === 'p' || tag === 'div') {
                    const inner = processContent(child);
                    if (inner.trim()) out += inner + '\n\n';
                } else if (/^h[1-6]$/.test(tag)) {
                    const level = parseInt(tag[1], 10);
                    out += '\n' + '#'.repeat(level) + ' ' + (child.textContent || '').trim() + '\n\n';
                } else if (tag === 'li') {
                    const inner = processContent(child);
                    if (inner.trim()) out += '- ' + inner + '\n';
                } else if (tag === 'blockquote') {
                    const inner = processContent(child);
                    if (inner.trim()) out += '> ' + inner.replace(/\n/g, '\n> ') + '\n\n';
                } else if (tag === 'br') {
                    out += '\n';
                } else if (tag === 'a') {
                    const href = child.getAttribute('href');
                    const text = (child.textContent || '').trim();
                    if (href && text) out += `[${text}](${href})`;
                    else out += text;
                } else if (tag === 'code' && !child.closest('pre')) {
                    out += '`' + (child.textContent || '').trim() + '`';
                } else if (tag === 'strong' || tag === 'b') {
                    out += '**' + (child.textContent || '').trim() + '**';
                } else if (tag === 'em' || tag === 'i') {
                    out += '*' + (child.textContent || '').trim() + '*';
                } else {
                    out += processContent(child);
                }
            }
        }
        return out.trim();
    }

    // -------------------------------------------------------------------------
    // ChatGPT extractor
    // -------------------------------------------------------------------------

    const ChatGPTExtractor = {
        name: 'ChatGPT',

        extractTitle() {
            if (document.title) {
                const cleaned = document.title
                    .replace(/\s*[-–—|]\s*ChatGPT$/i, '')
                    .replace(/^ChatGPT\s*[-–—|]\s*/i, '')
                    .trim();
                if (cleaned && cleaned !== 'ChatGPT') return cleaned;
            }
            const selectors = [
                '.conversation-header h1',
                '[data-testid="conversation-title"]',
                '.chat-title',
            ];
            const current = document.querySelector('a[data-interactive-row-link][aria-current="page"]');
            if (current && current.getAttribute('aria-label')) return current.getAttribute('aria-label').trim();
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent && el.textContent.trim()) {
                    return el.textContent.trim();
                }
            }
            return this._firstUserPreview() || 'Untitled Conversation';
        },

        _firstUserPreview() {
            const el = document.querySelector(
                '[data-user-message-bubble] .whitespace-pre-wrap, ' +
                'article[data-turn="user"] .user-message-bubble-color, ' +
                '[data-message-author-role="user"] .user-message-bubble-color, ' +
                'article[data-turn="user"] .whitespace-pre-wrap, ' +
                '[data-message-author-role="user"] .whitespace-pre-wrap'
            );
            if (!el || !el.textContent) return '';
            return (
                el.textContent
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .find((s) => s.length > 0) || ''
            );
        },

        extractMessages() {
            const elements = this._messageElements();
            return elements
                .map((el, i) => {
                    const role = this._guessRole(el, i);
                    const content = this._extractContent(el, role);
                    return { role, content };
                })
                .filter((m) => m.content && m.content.trim().length > 0);
        },

        _messageElements() {
            // Current UI: each message block starts with a print-only role heading.
            const roleHeadings = document.querySelectorAll('h4[data-conversation-role]');
            if (roleHeadings.length > 0) {
                return sortByDomOrder(Array.from(roleHeadings, (h) => h.parentElement));
            }

            const turns = Array.from(
                document.querySelectorAll(
                    'article[data-turn][data-testid^="conversation-turn"], article[data-turn]'
                )
            );
            if (turns.length > 0) return sortByDomOrder(turns);

            const byMessageId = Array.from(document.querySelectorAll('[data-message-id]'));
            if (byMessageId.length > 0) return sortByDomOrder(byMessageId);

            const byGroup = Array.from(document.querySelectorAll('[class*="group/turn-messages"]'));
            if (byGroup.length > 0) return sortByDomOrder(byGroup);

            return Array.from(document.querySelectorAll('.markdown'));
        },

        _guessRole(el, index) {
            const heading = el.querySelector(':scope > h4[data-conversation-role]');
            if (heading) return heading.getAttribute('data-conversation-role');

            const turn = el.getAttribute('data-turn');
            if (turn === 'user' || turn === 'assistant') return turn;

            const authorRole = el.getAttribute('data-message-author-role');
            if (authorRole === 'user') return 'user';
            if (authorRole === 'assistant') return 'assistant';

            const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
            if (cls.includes('user-message') || cls.includes('user')) return 'user';
            if (cls.includes('assistant') || cls.includes('agent-turn')) return 'assistant';
            if (el.querySelector('.user-message-bubble-color, [class*="user-message"]')) return 'user';
            if (el.querySelector('.markdown')) return 'assistant';

            return index % 2 === 0 ? 'user' : 'assistant';
        },

        _extractContent(el, role) {
            if (role === 'user') {
                const bubble = el.matches('.user-message-bubble-color')
                    ? el
                    : el.querySelector('.user-message-bubble-color');
                if (bubble) return cleanNode(bubble).textContent.trim();

                const preWrap = el.querySelector(
                    '[data-message-author-role="user"] .whitespace-pre-wrap, .whitespace-pre-wrap'
                );
                if (preWrap) return cleanNode(preWrap).textContent.trim();

                const textMessage = el.matches('.text-message') ? el : el.querySelector('.text-message');
                if (textMessage) return cleanNode(textMessage).textContent.trim();

                return cleanNode(el).textContent.trim();
            }

            const roots = el.querySelectorAll('[data-markdown-text-style="assistant-message"]');
            if (roots.length > 0) {
                return Array.from(roots, (r) => processContent(cleanNode(r)))
                    .filter(Boolean)
                    .join('\n\n');
            }

            const markdown = el.matches('.markdown') ? el : el.querySelector('.markdown');
            if (markdown) return processContent(cleanNode(markdown));
            return cleanNode(el).textContent.trim();
        },
    };

    // -------------------------------------------------------------------------
    // Claude extractor (derived from Nowledge Memory Exchange)
    // -------------------------------------------------------------------------

    const ClaudeExtractor = {
        name: 'Claude',

        extractTitle() {
            if (document.title) {
                const cleaned = document.title
                    .replace(/\s*[-–—]\s*Claude$/i, '')
                    .replace(/^Claude\s*[-–—]\s*/i, '')
                    .trim();
                if (cleaned && cleaned !== 'Claude') return cleaned;
            }
            const selectors = [
                'h1[data-testid="conversation-title"]',
                '.conversation-header h1',
                '.chat-header h1',
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent && el.textContent.trim()) {
                    return el.textContent.trim();
                }
            }
            return 'Untitled Conversation';
        },

        extractMessages() {
            const userEls = Array.from(document.querySelectorAll('[data-testid="user-message"]'));
            const assistantEls = Array.from(document.querySelectorAll('.font-claude-response')).filter(
                (el) => {
                    const cls = typeof el.className === 'string' ? el.className : '';
                    return cls.includes('leading-') || cls.includes('relative');
                }
            );
            const elements = sortByDomOrder([...userEls, ...assistantEls]);

            return elements
                .map((el, i) => {
                    const role = this._guessRole(el, i);
                    const content = this._extractContent(el, role);
                    return { role, content };
                })
                .filter((m) => m.content && m.content.trim().length > 0);
        },

        _guessRole(el, index) {
            if (el.getAttribute('data-testid') === 'user-message') return 'user';
            const cls = (typeof el.className === 'string' ? el.className : '') || '';
            if (cls.includes('font-user-message') || cls.includes('!font-user-message')) return 'user';
            if (cls.includes('font-claude-response') || el.hasAttribute('data-is-streaming')) return 'assistant';
            if (el.querySelector('[data-testid="user-message"]')) return 'user';
            if (el.querySelector('.font-claude-response')) return 'assistant';
            return index % 2 === 0 ? 'user' : 'assistant';
        },

        _extractContent(el, role) {
            if (role === 'user') {
                const clone = cleanNode(el, '.shrink-0');
                clone.querySelectorAll('.shrink-0').forEach((n) => {
                    const txt = n.textContent && n.textContent.trim();
                    if (txt && txt.length <= 3 && /^[A-Z]+$/.test(txt)) n.remove();
                });
                return clone.textContent.trim();
            }

            let out = '';

            const markdowns = el.querySelectorAll('.standard-markdown, .progressive-markdown');
            for (const md of markdowns) {
                const text = processContent(cleanNode(md, '.artifact-block-cell'));
                if (text) out += (out ? '\n\n' : '') + text;
            }

            const artifacts = el.querySelectorAll('.pt-3.pb-3, [class*="artifact"]');
            for (const art of artifacts) {
                const text = this._extractArtifact(art);
                if (text) out += (out ? '\n\n' : '') + text;
            }

            if (!out) {
                const body = el.querySelector('.font-claude-response-body');
                if (body) out = processContent(body);
            }

            if (!out) {
                out = cleanNode(el).textContent.trim();
            }

            return out;
        },

        _extractArtifact(container) {
            const selectors = ['.code-block__code code', 'code[class*="language-"]', 'pre code', 'code'];
            for (const sel of selectors) {
                const code = container.querySelector(sel);
                if (code) {
                    const text = code.textContent.trim();
                    if (text.length > 20) {
                        const lang =
                            code.className.match(/language-(\w+)/) ||
                            (code.parentElement && code.parentElement.className.match(/language-(\w+)/));
                        return '```' + (lang ? lang[1] : 'code') + '\n' + text + '\n```';
                    }
                }
            }
            return '';
        },
    };

    // -------------------------------------------------------------------------
    // Markdown formatting + copy/download
    // -------------------------------------------------------------------------

    function getExtractor() {
        const platform = detectPlatform();
        if (platform === 'claude') return ClaudeExtractor;
        return ChatGPTExtractor;
    }

    function sanitizeForFilename(title) {
        if (!title) return '';
        return title
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, '_')
            .replace(/[^\w\-_.]/g, '')
            .substring(0, 50)
            .replace(/^_+|_+$/g, '');
    }

    function generateFilename(title, platform) {
        const now = new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const safe = sanitizeForFilename(title);
        const prefix = platform === 'claude' ? 'claude' : 'chatgpt';
        return safe
            ? `${prefix}_${safe}_${date}_${time}.md`
            : `${prefix}_${date}_${time}.md`;
    }

    function formatAsMarkdown(title, messages, url, platform) {
        const now = new Date();
        const exportedAt = now.toISOString();

        let md = '---\n';
        md += `url: "${url || window.location.href}"\n`;
        md += `exported_date: "${exportedAt}"\n`;
        md += '---\n\n';

        md += `# ${title}\n\n`;

        messages.forEach((msg, idx) => {
            const label = msg.role === 'user' ? 'User' : 'Assistant';
            const body = msg.content.replace(/\n---\n/g, '\n----\n');
            md += `**${label}**\n\n${body}\n\n`;
            if (idx < messages.length - 1) md += '---\n\n';
        });

        return md.trim();
    }

    function getMarkdown() {
        const platform = detectPlatform();
        const extractor = getExtractor();
        const title = extractor.extractTitle();
        const messages = extractor.extractMessages();
        const url = window.location.href;
        if (messages.length === 0) {
            throw new Error('No messages found on this page.');
        }
        return {
            md: formatAsMarkdown(title, messages, url, platform),
            title,
            platform,
        };
    }

    async function copyAsMarkdown() {
        try {
            const { md } = getMarkdown();
            await navigator.clipboard.writeText(md);
            console.log('[Export] Copied as Markdown');
            showToast('Copied as Markdown');
        } catch (err) {
            console.error('[Export] Copy failed:', err);
            alert(err.message || 'Failed to copy Markdown.');
        }
    }

    function downloadMarkdown(content, filename) {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log('[Export] Downloaded:', filename);
        showToast(`Downloaded ${filename}`);
    }

    function downloadAsMarkdown() {
        try {
            const { md, title, platform } = getMarkdown();
            downloadMarkdown(md, generateFilename(title, platform));
        } catch (err) {
            console.error('[Export] Download failed:', err);
            alert(err.message || 'Failed to download Markdown.');
        }
    }

    function openMarkdown() {
        try {
            const { md } = getMarkdown();
            const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
        } catch (err) {
            console.error('[Export] Open failed:', err);
            alert(err.message || 'Failed to open Markdown.');
        }
    }

    function showToast(message) {
        const existing = document.getElementById('chatgpt-export-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'chatgpt-export-toast';
        toast.textContent = message;
        toast.style.cssText = [
            'position: fixed',
            'top: 16px',
            'left: 50%',
            'transform: translateX(-50%)',
            'z-index: 999999',
            'padding: 8px 16px',
            'border-radius: 8px',
            'background: #202123',
            'color: #fff',
            'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            'font-size: 13px',
            'box-shadow: 0 4px 12px rgba(0,0,0,0.3)',
            'pointer-events: none',
            'opacity: 0',
            'transition: opacity 0.2s ease',
        ].join(';');

        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 200);
            }, 2000);
        });
    }

    // -------------------------------------------------------------------------
    // UI: icons
    // -------------------------------------------------------------------------

    function getSpriteHref(symbolId) {
        const existingUse = document.querySelector('use[href*="/cdn/assets/sprites-core"]');
        const base = existingUse ? existingUse.getAttribute('href').split('#')[0] : '';
        return base ? `${base}#${symbolId}` : '';
    }

    function chatgptIcon(symbolId, fallbackSvg, size = 18) {
        const href = getSpriteHref(symbolId);
        if (href) {
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" aria-hidden="true" class="icon" style="flex-shrink:0"><use href="${href}" fill="currentColor"></use></svg>`;
        }
        return fallbackSvg;
    }

    function claudeIcon(charCode, size = 20) {
        return `<span data-cds="Icon" style="font-family:var(--font-anthropicons,Anthropicons-Variable);font-feature-settings:'liga' 0;font-optical-sizing:auto;font-style:normal;font-variation-settings:normal;line-height:1;width:1em;height:1em;display:flex;align-items:center;justify-content:center;flex-shrink:0;user-select:none;font-size:${size}px;font-weight:433.3;" aria-hidden="true">&#x${charCode.toString(16)};</span>`;
    }

    const copyIconFallback = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    const downloadIconFallback = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
    const openIconFallback = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
    const chevronIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

    function getIcons(platform) {
        if (platform === 'claude') {
            return {
                copy: claudeIcon(0xe056),
                download: claudeIcon(0xe063),
                open: claudeIcon(0xe015),
                chevron: chevronIcon,
            };
        }
        return {
            copy: chatgptIcon('ce3544', copyIconFallback),
            download: downloadIconFallback,
            open: chatgptIcon('630ca2', openIconFallback),
            chevron: chevronIcon,
        };
    }

    // -------------------------------------------------------------------------
    // UI: dropdown menu
    // -------------------------------------------------------------------------

    function createMenuItem(platform, { icon, label, onClick }) {
        const item = document.createElement('button');
        item.type = 'button';
        item.style.cssText = [
            'display: flex',
            'align-items: center',
            'gap: 10px',
            'width: 100%',
            'padding: 8px 12px',
            'border: none',
            'border-radius: 6px',
            'background: transparent',
            'color: #ececf1',
            'font-family: inherit',
            'font-size: 13px',
            'text-align: left',
            'cursor: pointer',
            'white-space: nowrap',
        ].join(';');
        item.innerHTML = `${icon}<span>${label}</span>`;
        item.addEventListener('mouseenter', () => {
            item.style.background = 'rgba(255,255,255,0.08)';
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = 'transparent';
        });
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
            closeMenu();
        });
        return item;
    }

    function buildMenu(platform) {
        const icons = getIcons(platform);
        const menu = document.createElement('div');
        menu.id = 'chatgpt-export-menu';
        menu.style.cssText = [
            'position: fixed',
            'top: 0',
            'left: 0',
            'min-width: 200px',
            'padding: 6px',
            'border-radius: 10px',
            'background: #2f2f2f',
            'border: 1px solid rgba(255,255,255,0.08)',
            'box-shadow: 0 8px 24px rgba(0,0,0,0.35)',
            'z-index: 999999',
            'display: none',
            'flex-direction: column',
            'gap: 2px',
        ].join(';');

        menu.appendChild(
            createMenuItem(platform, {
                icon: icons.copy,
                label: 'Copy page as Markdown',
                onClick: copyAsMarkdown,
            })
        );
        menu.appendChild(
            createMenuItem(platform, {
                icon: icons.open,
                label: 'Open Markdown',
                onClick: openMarkdown,
            })
        );
        menu.appendChild(
            createMenuItem(platform, {
                icon: icons.download,
                label: 'Download as Markdown',
                onClick: downloadAsMarkdown,
            })
        );

        return menu;
    }

    function positionMenu(menu, anchorRect) {
        const menuRect = menu.getBoundingClientRect();
        const margin = 8;

        let left = anchorRect.right - menuRect.width;
        let top = anchorRect.bottom + margin;

        if (left < margin) left = margin;
        if (left + menuRect.width > window.innerWidth - margin) {
            left = window.innerWidth - menuRect.width - margin;
        }
        if (top + menuRect.height > window.innerHeight - margin) {
            top = anchorRect.top - menuRect.height - margin;
        }
        if (top < margin) top = margin;

        menu.style.transform = `translate(${left}px, ${top}px)`;
    }

    function closeMenu() {
        const menu = document.getElementById('chatgpt-export-menu');
        if (menu) {
            menu.style.display = 'none';
            if (menu.parentElement) menu.parentElement.removeChild(menu);
        }
        document.removeEventListener('click', onDocClick);
    }

    function openMenu(anchor) {
        const platform = detectPlatform();
        let menu = document.getElementById('chatgpt-export-menu');
        if (!menu) {
            menu = buildMenu(platform);
            document.body.appendChild(menu);
        }

        menu.style.display = 'flex';
        menu.style.visibility = 'hidden';
        positionMenu(menu, anchor.getBoundingClientRect());
        menu.style.visibility = 'visible';

        setTimeout(() => document.addEventListener('click', onDocClick), 0);
    }

    function onDocClick(e) {
        const group = document.getElementById('chatgpt-export-group');
        const menu = document.getElementById('chatgpt-export-menu');
        const clickedGroup = group && group.contains(e.target);
        const clickedMenu = menu && menu.contains(e.target);
        if (!clickedGroup && !clickedMenu) {
            closeMenu();
        }
    }

    // -------------------------------------------------------------------------
    // UI: header buttons
    // -------------------------------------------------------------------------

    function getHeaderSelector(platform) {
        if (platform === 'claude') return '[data-testid="wiggle-controls-actions"]';
        return '[data-app-shell-main-titlebar] [data-app-shell-header-obstacle], #conversation-header-actions';
    }

    function createSplitButton(platform) {
        const icons = getIcons(platform);
        const group = document.createElement('div');
        group.id = 'chatgpt-export-group';
        // ChatGPT's titlebar is pointer-events:none; re-enable clicks on our group.
        group.style.cssText = 'position: relative; display: flex; align-items: center; pointer-events: auto;';

        const sharedBtnStyle = [
            'display: inline-flex',
            'align-items: center',
            'justify-content: center',
            'height: 36px',
            'background: transparent',
            'border: 1px solid transparent',
            'cursor: pointer',
            'transition: background-color 0.15s ease',
            'font-family: inherit',
        ].join(';');

        const mainBtn = document.createElement('button');
        mainBtn.type = 'button';
        mainBtn.style.cssText = sharedBtnStyle + [
            'gap: 6px',
            'padding: 0 10px 0 12px',
            'border-radius: 8px 0 0 8px',
            'border-right-color: rgba(255,255,255,0.06)',
            'color: var(--text-primary, #ececf1)',
        ].join(';');
        mainBtn.innerHTML = `${icons.copy}<span style="font-size:13px;font-weight:500;">Copy</span>`;
        mainBtn.title = 'Copy page as Markdown';
        mainBtn.addEventListener('mouseenter', () => {
            mainBtn.style.background = 'var(--surface-hover, rgba(255,255,255,0.08))';
        });
        mainBtn.addEventListener('mouseleave', () => {
            mainBtn.style.background = 'transparent';
        });
        mainBtn.addEventListener('click', copyAsMarkdown);

        const arrowBtn = document.createElement('button');
        arrowBtn.type = 'button';
        arrowBtn.id = 'chatgpt-export-arrow';
        arrowBtn.style.cssText = sharedBtnStyle + [
            'width: 26px',
            'padding: 0',
            'border-radius: 0 8px 8px 0',
            'color: var(--text-primary, #ececf1)',
        ].join(';');
        arrowBtn.innerHTML = icons.chevron;
        arrowBtn.title = 'More export options';
        arrowBtn.addEventListener('mouseenter', () => {
            arrowBtn.style.background = 'var(--surface-hover, rgba(255,255,255,0.08))';
        });
        arrowBtn.addEventListener('mouseleave', () => {
            arrowBtn.style.background = 'transparent';
        });
        arrowBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = document.getElementById('chatgpt-export-menu');
            if (menu && menu.style.display === 'flex') {
                closeMenu();
            } else {
                openMenu(arrowBtn);
            }
        });

        group.appendChild(mainBtn);
        group.appendChild(arrowBtn);
        return group;
    }

    function addHeaderExportButton() {
        const platform = detectPlatform();
        if (platform === 'unknown') return;

        const selector = getHeaderSelector(platform);
        const header = document.querySelector(selector);
        if (!header || document.getElementById('chatgpt-export-group')) return;

        const group = createSplitButton(platform);
        header.insertBefore(group, header.firstChild);
    }

    // -------------------------------------------------------------------------
    // Init (SPA-aware)
    // -------------------------------------------------------------------------

    function init() {
        addHeaderExportButton();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    const observer = new MutationObserver(() => {
        if (!document.getElementById('chatgpt-export-group')) {
            addHeaderExportButton();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
