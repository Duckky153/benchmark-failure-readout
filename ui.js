/*
  Small DOM helpers shared by both pages. No logic about scores lives here.
  Sets window.BenchUI.
*/
(function (root) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    setAttrs(node, attrs);
    append(node, children);
    return node;
  }

  function svg(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    setAttrs(node, attrs);
    append(node, children);
    return node;
  }

  function setAttrs(node, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'on') Object.keys(v).forEach(function (evt) { node.addEventListener(evt, v[evt]); });
      else node.setAttribute(k, v === true ? '' : String(v));
    });
  }

  function append(node, children) {
    if (children === null || children === undefined) return;
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  function byId(id) { return document.getElementById(id); }

  // Make an SVG group or element behave like a button for mouse and keyboard.
  function clickable(node, label, handler) {
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', label);
    node.addEventListener('click', handler);
    node.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(e); }
    });
    return node;
  }

  // Copy text; if the clipboard is refused, select the text so it can be copied by hand.
  function copyText(text, selectNode, statusNode) {
    function selectFallback() {
      try {
        var range = document.createRange();
        range.selectNodeContents(selectNode);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) { /* nothing else to try */ }
      if (statusNode) statusNode.textContent = 'Selected. Press Ctrl+C or Cmd+C to copy.';
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          if (statusNode) statusNode.textContent = 'Copied.';
        }, selectFallback);
        return;
      }
    } catch (e) { /* fall through */ }
    selectFallback();
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  // Width available for a chart inside a container.
  function widthOf(node, fallback) {
    var w = node && node.clientWidth;
    return w && w > 0 ? w : (fallback || 640);
  }

  root.BenchUI = { el: el, svg: svg, clear: clear, byId: byId, clickable: clickable, copyText: copyText, debounce: debounce, widthOf: widthOf };
})(typeof window !== 'undefined' ? window : globalThis);
