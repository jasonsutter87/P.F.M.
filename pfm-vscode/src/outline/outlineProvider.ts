/**
 * PFM Document Symbol Provider - Provides sidebar outline of sections.
 */

import * as vscode from 'vscode';
import { parsePFM, SECTION_DESCRIPTIONS } from '../parser';

export class PFMOutlineProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.DocumentSymbol[] {
    const pfm = parsePFM(document.getText());
    const symbols: vscode.DocumentSymbol[] = [];

    // Top-level: PFM document
    const docRange = new vscode.Range(
      new vscode.Position(pfm.magicLine, 0),
      new vscode.Position(
        pfm.eofLine >= 0 ? pfm.eofLine : document.lineCount - 1,
        0
      )
    );

    const docSymbol = new vscode.DocumentSymbol(
      `PFM v${pfm.formatVersion}`,
      Object.entries(pfm.meta)
        .filter(([k]) => k === 'agent' || k === 'model')
        .map(([k, v]) => `${k}: ${v}`)
        .join(', '),
      vscode.SymbolKind.File,
      docRange,
      docRange
    );

    // Metadata as a namespace
    const metaKeys = Object.keys(pfm.meta);
    if (metaKeys.length > 0) {
      const metaSymbol = new vscode.DocumentSymbol(
        'meta',
        `${metaKeys.length} fields`,
        vscode.SymbolKind.Namespace,
        docRange,
        docRange
      );
      docSymbol.children.push(metaSymbol);
    }

    // Sections
    for (const section of pfm.sections) {
      const startPos = new vscode.Position(section.headerLine, 0);
      const endPos = new vscode.Position(
        section.contentEndLine,
        document.lineAt(Math.min(section.contentEndLine, document.lineCount - 1))
          .text.length
      );
      const range = new vscode.Range(startPos, endPos);
      const selRange = new vscode.Range(
        startPos,
        new vscode.Position(section.headerLine, `#@${section.name}`.length)
      );

      const desc = SECTION_DESCRIPTIONS[section.name] || `${section.content.length} chars`;
      const symbol = new vscode.DocumentSymbol(
        section.name,
        desc,
        vscode.SymbolKind.Module,
        range,
        selRange
      );
      docSymbol.children.push(symbol);
    }

    symbols.push(docSymbol);
    return symbols;
  }
}
