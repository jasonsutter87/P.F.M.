/**
 * PFM VS Code Extension - Entry point.
 *
 * Registers all providers: syntax highlighting (via tmLanguage),
 * document outline, preview panel, hover tooltips, CodeLens, and commands.
 */

import * as vscode from 'vscode';
import { parsePFM, computeChecksum } from './parser';
import { PFMPreviewPanel } from './preview/previewPanel';
import { PFMOutlineProvider } from './outline/outlineProvider';
import { PFMHoverProvider } from './hover/hoverProvider';
import { PFMCodeLensProvider } from './codelens/codeLensProvider';

const PFM_SELECTOR: vscode.DocumentSelector = { language: 'pfm', scheme: 'file' };

/** Constant-time string comparison to prevent timing side-channels. */
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let result = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

export function activate(context: vscode.ExtensionContext): void {
  // Document Symbol Provider (outline)
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      PFM_SELECTOR,
      new PFMOutlineProvider()
    )
  );

  // Hover Provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(PFM_SELECTOR, new PFMHoverProvider())
  );

  // CodeLens Provider
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      PFM_SELECTOR,
      new PFMCodeLensProvider()
    )
  );

  // Command: Open Preview
  context.subscriptions.push(
    vscode.commands.registerCommand('pfm.openPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'pfm') {
        vscode.window.showWarningMessage('Open a .pfm file first.');
        return;
      }
      PFMPreviewPanel.show(editor.document.uri, editor.document.getText());
    })
  );

  // Command: Validate Checksum
  context.subscriptions.push(
    vscode.commands.registerCommand('pfm.validateChecksum', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'pfm') {
        vscode.window.showWarningMessage('Open a .pfm file first.');
        return;
      }

      const doc = parsePFM(editor.document.getText());
      const expected = doc.meta.checksum;
      if (!expected) {
        vscode.window.showWarningMessage('No checksum found in metadata.');
        return;
      }

      const actual = await computeChecksum(doc.sections);
      if (timingSafeEqual(actual, expected)) {
        vscode.window.showInformationMessage('PFM Checksum: VALID');
      } else {
        vscode.window.showErrorMessage(
          `PFM Checksum: INVALID\nExpected: ${expected}\nGot: ${actual}`
        );
      }
    })
  );

  // Command: Go to Section (quick pick)
  context.subscriptions.push(
    vscode.commands.registerCommand('pfm.goToSection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'pfm') {
        vscode.window.showWarningMessage('Open a .pfm file first.');
        return;
      }

      const doc = parsePFM(editor.document.getText());
      if (doc.sections.length === 0) {
        vscode.window.showInformationMessage('No sections found.');
        return;
      }

      const items = doc.sections.map((s) => ({
        label: s.name,
        description: `Line ${s.headerLine + 1}`,
        detail: s.content.substring(0, 80).replace(/\n/g, ' '),
        line: s.headerLine,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Jump to section...',
      });

      if (picked) {
        const pos = new vscode.Position(picked.line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter
        );
      }
    })
  );
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
