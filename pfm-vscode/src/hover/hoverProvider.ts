/**
 * PFM Hover Provider - Shows tooltips for meta keys and section headers.
 */

import * as vscode from 'vscode';
import { META_FIELD_DESCRIPTIONS, SECTION_DESCRIPTIONS } from '../parser';

export class PFMHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | null {
    const line = document.lineAt(position.line).text;

    // Hover on section header: #@<name>
    if (line.startsWith('#@')) {
      const name = line.substring(2).trim();
      const desc = SECTION_DESCRIPTIONS[name];
      if (desc) {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**Section: \`${name}\`**\n\n${desc}`);
        return new vscode.Hover(md);
      }
      // Custom section
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**Section: \`${name}\`**\n\nCustom user-defined section.`);
      return new vscode.Hover(md);
    }

    // Hover on meta key: <key>: <value>
    const metaMatch = line.match(/^(\w+):\s+(.*)$/);
    if (metaMatch) {
      const key = metaMatch[1];
      const desc = META_FIELD_DESCRIPTIONS[key];
      if (desc) {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**Meta: \`${key}\`**\n\n${desc}`);
        return new vscode.Hover(md);
      }
    }

    // Hover on magic line
    if (line.startsWith('#!PFM')) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(
        '**PFM Magic Line**\n\nIdentifies this file as PFM format. ' +
          'The version number follows the slash. `:STREAM` flag indicates streaming mode.'
      );
      return new vscode.Hover(md);
    }

    // Hover on EOF marker
    if (line.startsWith('#!END')) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(
        '**PFM EOF Marker**\n\nEnd of file marker. ' +
          'In stream mode, the number after the colon is the byte offset of the trailing index.'
      );
      return new vscode.Hover(md);
    }

    // Hover on escaped line
    if (line.startsWith('\\#')) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(
        '**Escaped Line**\n\nThis line starts with `\\#` because the original content ' +
          'started with `#@` or `#!`, which would be confused with PFM markers. ' +
          'The backslash is removed when reading.'
      );
      return new vscode.Hover(md);
    }

    return null;
  }
}
