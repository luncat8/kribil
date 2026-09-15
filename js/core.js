/* Крибил — общее пространство имён.
	 Classic <script> под фай:// (глобал Kribil) и node (require) одновременно. */
"use strict";
(function (global) {
	const K = global.Kribil ?? (global.Kribil = {});
	if (typeof module !== "undefined" && module.exports) module.exports = K;
})(typeof globalThis !== "undefined" ? globalThis : this);
