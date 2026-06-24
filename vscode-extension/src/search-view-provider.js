const vscode = require('vscode');

class SearchViewProvider {
  constructor(jobsProvider) {
    this._jobsProvider = jobsProvider;
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'search') {
        this._jobsProvider.setFilter(msg.query);
      } else if (msg.type === 'clear') {
        this._jobsProvider.setFilter('');
      }
    });
  }

  _getHtml() {
    return `<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; padding: 6px; font-family: var(--vscode-font-family); background: var(--vscode-sideBar-background); }
  .search-wrap { display: flex; gap: 4px; }
  input {
    flex: 1; padding: 5px 8px; border: 1px solid var(--vscode-input-border);
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border-radius: 4px; font-size: 12px; outline: none;
  }
  input:focus { border-color: var(--vscode-focusBorder); }
  button {
    padding: 4px 8px; border: none; border-radius: 4px; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    font-size: 12px;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .clear-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style>
</head>
<body>
  <div class="search-wrap">
    <input id="search" type="text" placeholder="Filter jobs..." />
    <button class="clear-btn" id="clearBtn">✕</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('search');
    const clearBtn = document.getElementById('clearBtn');
    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        vscode.postMessage({ type: 'search', query: input.value });
      }, 200);
    });
    clearBtn.addEventListener('click', () => {
      input.value = '';
      vscode.postMessage({ type: 'clear' });
    });
  </script>
</body>
</html>`;
  }
}

module.exports = { SearchViewProvider };
