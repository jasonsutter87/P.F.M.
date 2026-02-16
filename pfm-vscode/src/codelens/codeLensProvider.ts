/**
 * PFM CodeLens Provider - Inline "Open Preview" and "Validate Checksum" buttons.
 */

import * as vscode from 'vscode';

export class PFMCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];

    // Find the magic line (usually line 0)
    for (let i = 0; i < Math.min(5, document.lineCount); i++) {
      const line = document.lineAt(i).text;
      if (line.startsWith('#!PFM')) {
        const range = new vscode.Range(i, 0, i, line.length);

        // Open Preview button
        lenses.push(
          new vscode.CodeLens(range, {
            title: '$(preview) Open Preview',
            command: 'pfm.openPreview',
            tooltip: 'Open PFM preview panel (Cmd+Shift+V)',
          })
        );

        // Validate Checksum button
        lenses.push(
          new vscode.CodeLens(range, {
            title: '$(shield) Validate Checksum',
            command: 'pfm.validateChecksum',
            tooltip: 'Verify SHA-256 checksum integrity',
          })
        );

        break;
      }
    }

    return lenses;
  }
}
