// 課堂工具箱共用：模組註冊處與共用小工具。必須在 toolkit/ 其他檔案與 toolkit.js 之前載入。
(function (window) {
  'use strict';
  const TK = (window.ToolkitModules = window.ToolkitModules || {});

  /** 把任意文字轉成可安全放進 innerHTML 的字串（學生輸入的內容一律要先經過這裡）。
   *  連引號一起轉換，所以也能放進 title="..." 之類的屬性值。 */
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  TK.escapeHtml = function escapeHtml(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  };
})(window);
