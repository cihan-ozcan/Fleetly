/* =============================================================================
 * fleetly-icons.js — Fleetly Editorial Icon Set
 * -----------------------------------------------------------------------------
 * Fleetly'ye özel hairline (1.5px) icon kütüphanesi. Newsreader/krem editorial
 * tasarım diline uygun ince çizgi geometrik stil.
 *
 * Kullanım:
 *
 *   <i data-icon="truck"></i>                  → SVG'ye çevrilir
 *   <i data-icon="check" data-icon-size="20"></i>
 *   FleetlyIcons.svg('fuel')                   → SVGElement döner
 *   FleetlyIcons.html('fuel', { size: 24 })    → outerHTML string döner
 *   FleetlyIcons.exists('truck')               → true/false
 *
 * Stil:
 *   • viewBox 0 0 24 24
 *   • stroke-width 1.5
 *   • stroke-linecap round, stroke-linejoin round
 *   • fill none
 *   • stroke currentColor (renk CSS color ile kontrol edilir)
 *
 * ===========================================================================*/

(function () {
  'use strict';

  // ── PATH KÜTÜPHANESİ — alfabetik ──
  // Her değer ya path string'i, ya da çoklu element için array of {tag, attrs}
  const ICONS = {

    // ════ GENEL UI / OK ════
    'arrow-left':       'M19 12H5M11 6l-6 6 6 6',
    'arrow-right':      'M5 12h14M13 6l6 6-6 6',
    'arrow-up':         'M12 19V5M6 11l6-6 6 6',
    'arrow-down':       'M12 5v14M6 13l6 6 6-6',
    'arrow-up-right':   'M7 17 17 7M8 7h9v9',
    'arrow-down-right': 'M7 7l10 10M17 8v9H8',
    'chevron-left':     'M15 6l-6 6 6 6',
    'chevron-right':    'M9 6l6 6-6 6',
    'chevron-up':       'M6 15l6-6 6 6',
    'chevron-down':     'M6 9l6 6 6-6',
    'chevrons-up-down': 'M7 14l5 5 5-5M7 10l5-5 5 5',
    'navigation':       'M12 3l8 18-8-4-8 4z',
    'compass':          [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M16 8l-2 6-6 2 2-6z' } },
    ],

    // ════ ONAY / DURUM ════
    'check':            'M5 13l4 4L19 7',
    'check-circle':     [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M8 12l3 3 5-6' } },
    ],
    'check-double':     'M2 12l5 5 5-5M9 12l5 5 11-11M15 7l5 5',
    'x':                'M6 6l12 12M18 6L6 18',
    'x-circle':         [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M9 9l6 6M15 9l-6 6' } },
    ],
    'plus':             'M12 5v14M5 12h14',
    'plus-circle':      [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M12 8v8M8 12h8' } },
    ],
    'minus':            'M5 12h14',
    'minus-circle':     [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M8 12h8' } },
    ],
    'ban':              [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M6 6l12 12' } },
    ],
    'circle':           [{ tag:'circle', attrs:{ cx:12, cy:12, r:9 } }],
    'circle-filled':    [{ tag:'circle', attrs:{ cx:12, cy:12, r:9, fill:'currentColor' } }],
    'dot':              [{ tag:'circle', attrs:{ cx:12, cy:12, r:3, fill:'currentColor' } }],

    // ════ DÜZENLEME ════
    'edit':             'M4 20h4l11-11-4-4L4 16zM13 6l4 4',
    'pencil':           'M4 20h4l11-11-4-4L4 16zM13 6l4 4',
    'trash':            'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13M10 11v6M14 11v6',
    'copy':             [
      { tag:'rect', attrs:{ x:8, y:8, width:13, height:13, rx:2 } },
      { tag:'path', attrs:{ d:'M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1' } },
    ],
    'save':             'M5 5v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-3-3H6a1 1 0 0 0-1 1zM7 5h9v5H7zM8 13h8v6H8z',
    'paperclip':        'M21 11l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8',

    // ════ ARAMA / FİLTRE ════
    'search':           [
      { tag:'circle', attrs:{ cx:11, cy:11, r:6 } },
      { tag:'path', attrs:{ d:'M16 16l5 5' } },
    ],
    'search-plus':      [
      { tag:'circle', attrs:{ cx:11, cy:11, r:6 } },
      { tag:'path', attrs:{ d:'M16 16l5 5M11 8v6M8 11h6' } },
    ],
    'filter':           'M4 5h16l-6 9v6l-4-2v-4z',
    'sort':             'M3 7h18M6 12h12M9 17h6',
    'menu':             'M4 7h16M4 12h16M4 17h16',
    'more-horizontal':  [
      { tag:'circle', attrs:{ cx:5, cy:12, r:1.5, fill:'currentColor' } },
      { tag:'circle', attrs:{ cx:12, cy:12, r:1.5, fill:'currentColor' } },
      { tag:'circle', attrs:{ cx:19, cy:12, r:1.5, fill:'currentColor' } },
    ],
    'more-vertical':    [
      { tag:'circle', attrs:{ cx:12, cy:5, r:1.5, fill:'currentColor' } },
      { tag:'circle', attrs:{ cx:12, cy:12, r:1.5, fill:'currentColor' } },
      { tag:'circle', attrs:{ cx:12, cy:19, r:1.5, fill:'currentColor' } },
    ],
    'apps':             'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',

    // ════ SİSTEM / GENEL ════
    'home':             'M3 12L12 3l9 9M5 10v10h14V10',
    'settings':         [
      { tag:'circle', attrs:{ cx:12, cy:12, r:3 } },
      { tag:'path', attrs:{ d:'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' } },
    ],
    'sliders':          'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
    'refresh':          'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',
    'rotate':           'M21 12a9 9 0 1 1-3.5-7.1M21 5v5h-5',
    'power':            'M12 4v8M5.6 8.6a8 8 0 1 0 12.8 0',
    'log-out':          'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H10',
    'log-in':           'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
    'external-link':    'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
    'link':             'M10 14a4 4 0 0 1 0-6l2-2a4 4 0 0 1 6 6l-1 1M14 10a4 4 0 0 1 0 6l-2 2a4 4 0 0 1-6-6l1-1',

    // ════ KİŞİ / İLETİŞİM ════
    'user':             [
      { tag:'circle', attrs:{ cx:12, cy:8, r:4 } },
      { tag:'path', attrs:{ d:'M5 21v-1a7 7 0 0 1 14 0v1' } },
    ],
    'user-plus':        [
      { tag:'circle', attrs:{ cx:9, cy:8, r:4 } },
      { tag:'path', attrs:{ d:'M2 21v-1a7 7 0 0 1 14 0v1M19 8v6M16 11h6' } },
    ],
    'users':            [
      { tag:'circle', attrs:{ cx:9, cy:8, r:3.5 } },
      { tag:'path', attrs:{ d:'M2 20v-1a6 6 0 0 1 14 0v1M16 4a3.5 3.5 0 0 1 0 7M22 20v-1a6 6 0 0 0-3-5' } },
    ],
    'driver':           [
      { tag:'circle', attrs:{ cx:12, cy:8, r:4 } },
      { tag:'path', attrs:{ d:'M5 21v-1a7 7 0 0 1 14 0v1M9 19h6' } },
    ],
    'phone':            'M5 4h4l2 5-2 2a11 11 0 0 0 5 5l2-2 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
    'phone-android':    [
      { tag:'rect', attrs:{ x:7, y:3, width:10, height:18, rx:2 } },
      { tag:'path', attrs:{ d:'M11 18h2' } },
    ],
    'mail':             [
      { tag:'rect', attrs:{ x:3, y:5, width:18, height:14, rx:1 } },
      { tag:'path', attrs:{ d:'M3 7l9 6 9-6' } },
    ],
    'mail-open':        'M3 19V9l9-6 9 6v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9l9 6 9-6',
    'message-circle':   'M21 12a8 8 0 1 1-3-6L5 4l1 5a8 8 0 0 0-1 3 8 8 0 0 0 8 8 8 8 0 0 0 8-8z',
    'message-square':   'M21 12a7 7 0 0 1-7 7H8l-5 4V8a7 7 0 0 1 7-7h3a7 7 0 0 1 7 7z',
    'forum':            'M3 17v-7a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H8l-5 3zM10 14h4a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3h-1l-3 2v-2',
    'send':             'M22 2L11 13M22 2l-7 20-4-9-9-4z',
    'megaphone':        'M3 11v2a2 2 0 0 0 2 2h1l4 4V5L6 9H5a2 2 0 0 0-2 2zM10 5l8-2v18l-8-2M14 9a3 3 0 0 1 0 6',
    'bell':             'M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3zM10 19a2 2 0 0 0 4 0',
    'bell-off':         'M14 8a4 4 0 0 0-8 0v5l-2 3h11M16 17l3 3M2 4l16 16M10 19a2 2 0 0 0 4 0',
    'wave':             'M9 11c0-2 1.5-3 3-3s3 1 3 3M5 11c0-4 3-7 7-7s7 3 7 7M3 11c0 5 4 9 9 9s9-4 9-9',

    // ════ GÖZ / KİLİT ════
    'eye':              [
      { tag:'path', attrs:{ d:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z' } },
      { tag:'circle', attrs:{ cx:12, cy:12, r:3 } },
    ],
    'eye-off':          'M2 2l20 20M6 6a13 13 0 0 0-4 6s4 7 10 7c1.7 0 3.3-.4 4.7-1M9 9a3 3 0 0 0 0 6M14 14a3 3 0 0 0 .9-2.6M11.5 5a13 13 0 0 1 .5 0c6 0 10 7 10 7a13 13 0 0 1-3 4',
    'lock':             [
      { tag:'rect', attrs:{ x:5, y:11, width:14, height:10, rx:1 } },
      { tag:'path', attrs:{ d:'M8 11V8a4 4 0 0 1 8 0v3' } },
    ],
    'unlock':           [
      { tag:'rect', attrs:{ x:5, y:11, width:14, height:10, rx:1 } },
      { tag:'path', attrs:{ d:'M8 11V8a4 4 0 0 1 7-2.6' } },
    ],
    'key':              [
      { tag:'circle', attrs:{ cx:7, cy:14, r:4 } },
      { tag:'path', attrs:{ d:'M10.5 11.5l9-9M16 6l3 3M14 8l3 3' } },
    ],
    'fingerprint':      'M12 11v3a3 3 0 0 1-6 0M8 5.2A6 6 0 0 1 18 10v4M3 9a9 9 0 0 1 6-6M21 11A9 9 0 0 0 12 2M16 14a4 4 0 0 1-4 4M4 21c.5-2 1-4 1-7M12 18c-.6 1-2 2-3 3',

    // ════ DÖKÜMAN ════
    'file':             'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
    'file-text':        'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h6',
    'pdf':              'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 14v3M8 14h2a1.5 1.5 0 0 1 0 3H8M12 17v-3h2M12 15h2M16 14v3M16 14h2',
    'clipboard':        [
      { tag:'rect', attrs:{ x:6, y:5, width:12, height:16, rx:1 } },
      { tag:'rect', attrs:{ x:9, y:3, width:6, height:4, rx:0.5 } },
    ],
    'clipboard-check':  [
      { tag:'rect', attrs:{ x:6, y:5, width:12, height:16, rx:1 } },
      { tag:'rect', attrs:{ x:9, y:3, width:6, height:4, rx:0.5 } },
      { tag:'path', attrs:{ d:'M9 14l2 2 4-4' } },
    ],
    'description':      'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h6M8 9h2',
    'note':             [
      { tag:'rect', attrs:{ x:5, y:4, width:14, height:16, rx:1 } },
      { tag:'path', attrs:{ d:'M9 9h6M9 13h6M9 17h4' } },
    ],
    'signature':        'M3 17l4-2 4-9 3 9 3-4 4 2M3 21h18',

    // ════ FOTO / KAMERA ════
    'camera':           [
      { tag:'rect', attrs:{ x:3, y:7, width:18, height:14, rx:2 } },
      { tag:'circle', attrs:{ cx:12, cy:14, r:4 } },
      { tag:'path', attrs:{ d:'M9 7l1.5-3h3L15 7' } },
    ],
    'camera-plus':      [
      { tag:'rect', attrs:{ x:3, y:7, width:18, height:14, rx:2 } },
      { tag:'circle', attrs:{ cx:12, cy:14, r:4 } },
      { tag:'path', attrs:{ d:'M9 7l1.5-3h3L15 7M19 4v3M21 5.5h-3' } },
    ],
    'photo':            [
      { tag:'rect', attrs:{ x:3, y:5, width:18, height:14, rx:1 } },
      { tag:'circle', attrs:{ cx:8, cy:10, r:2 } },
      { tag:'path', attrs:{ d:'M3 17l5-5 4 4 3-3 6 6' } },
    ],
    'photo-library':    [
      { tag:'rect', attrs:{ x:3, y:7, width:14, height:14, rx:1 } },
      { tag:'path', attrs:{ d:'M7 5h12a2 2 0 0 1 2 2v12' } },
      { tag:'path', attrs:{ d:'M3 17l4-4 3 3 2-2 5 5' } },
    ],
    'image':            [
      { tag:'rect', attrs:{ x:3, y:5, width:18, height:14, rx:1 } },
      { tag:'circle', attrs:{ cx:8, cy:10, r:2 } },
      { tag:'path', attrs:{ d:'M3 17l5-5 4 4 3-3 6 6' } },
    ],
    'qr-code':          'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2',

    // ════ FİLO / ARAÇ ════
    'truck':            [
      { tag:'path', attrs:{ d:'M2 7h12v10H2zM14 11h4l3 3v3h-7z' } },
      { tag:'circle', attrs:{ cx:6, cy:18, r:2 } },
      { tag:'circle', attrs:{ cx:17, cy:18, r:2 } },
    ],
    'truck-rear':       [
      { tag:'rect', attrs:{ x:4, y:5, width:16, height:12, rx:1 } },
      { tag:'path', attrs:{ d:'M8 5v12M16 5v12M4 11h16' } },
      { tag:'circle', attrs:{ cx:8, cy:19, r:1.5 } },
      { tag:'circle', attrs:{ cx:16, cy:19, r:1.5 } },
    ],
    'container':        [
      { tag:'rect', attrs:{ x:3, y:7, width:18, height:12 } },
      { tag:'path', attrs:{ d:'M7 7v12M11 7v12M15 7v12M19 7v12' } },
    ],
    'trailer':          [
      { tag:'rect', attrs:{ x:2, y:6, width:18, height:10 } },
      { tag:'circle', attrs:{ cx:7, cy:18, r:2 } },
      { tag:'circle', attrs:{ cx:14, cy:18, r:2 } },
      { tag:'path', attrs:{ d:'M20 11h2v3h-2' } },
    ],
    'wheel':            [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'circle', attrs:{ cx:12, cy:12, r:3 } },
      { tag:'path', attrs:{ d:'M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2M5.6 18.4l4.2-4.2M14.2 9.8l4.2-4.2' } },
    ],
    'parking':          [
      { tag:'rect', attrs:{ x:4, y:4, width:16, height:16, rx:2 } },
      { tag:'path', attrs:{ d:'M9 17V7h4a3 3 0 0 1 0 6H9' } },
    ],
    'road':             'M5 21l3-18M19 21l-3-18M12 5v3M12 11v3M12 17v3',
    'route':            [
      { tag:'circle', attrs:{ cx:6, cy:18, r:3 } },
      { tag:'circle', attrs:{ cx:18, cy:6, r:3 } },
      { tag:'path', attrs:{ d:'M9 18h6a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h6' } },
    ],
    'navigation-pin':   'M12 22l-7-7a8 8 0 1 1 14 0l-7 7zM10 11l4-3-2 5z',
    'anchor':           [
      { tag:'circle', attrs:{ cx:12, cy:5, r:2 } },
      { tag:'path', attrs:{ d:'M12 7v15M9 11h6M5 14c0 5 3 8 7 8s7-3 7-8' } },
    ],
    'warehouse':        'M3 21V11l9-6 9 6v10zM7 21v-7h10v7M11 21v-3h2v3',
    'building':         [
      { tag:'rect', attrs:{ x:4, y:3, width:16, height:18 } },
      { tag:'path', attrs:{ d:'M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3' } },
    ],
    'factory':          'M3 21V11l5 4V11l5 4V11l5 4V7l3-3v17zM7 21v-3h2v3M13 21v-3h2v3M3 14h18',
    'port':             [
      { tag:'path', attrs:{ d:'M12 4v6M9 7h6' } },
      { tag:'path', attrs:{ d:'M3 11h18l-2 6a3 3 0 0 1-3 2H8a3 3 0 0 1-3-2z' } },
    ],
    'ship':             'M3 17l9-13 9 13M5 17h14M5 17v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3M9 12V9h6v3',
    'shipping-fast':    [
      { tag:'path', attrs:{ d:'M3 8h11v9H3zM14 12h4l3 3v2h-7z' } },
      { tag:'circle', attrs:{ cx:7, cy:18, r:2 } },
      { tag:'circle', attrs:{ cx:17, cy:18, r:2 } },
      { tag:'path', attrs:{ d:'M2 11h3M1 14h2' } },
    ],
    'box':              'M21 8L12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',

    // ════ YAKIT / BAKIM ════
    'fuel':             [
      { tag:'path', attrs:{ d:'M5 21V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v16M5 11h8M5 21h8' } },
      { tag:'path', attrs:{ d:'M13 8l3-1v9a2 2 0 0 0 2 2v0a2 2 0 0 0 2-2V11l-3-3' } },
    ],
    'fuel-pump':        [
      { tag:'rect', attrs:{ x:5, y:3, width:8, height:18, rx:1 } },
      { tag:'path', attrs:{ d:'M5 11h8M14 8h2v9a2 2 0 0 0 2 2 2 2 0 0 0 2-2V11l-3-3' } },
    ],
    'wrench':           'M14 6a4 4 0 0 1 6 4l-2 2-3-3 2-2a4 4 0 0 0-3 3 4 4 0 0 0 0 4l-7 7a2 2 0 0 1-3-3z',
    'tools':            'M5 21l4-4M3 19l8-8a4 4 0 0 1 6-6l-3 3 2 2 3-3a4 4 0 0 1-6 6L9 19a2 2 0 0 1-3 0z',
    'screwdriver':      'M14 4l6 6-3 3-2-2-7 7-3-3 7-7-2-2zM6 17l-2 2',
    'gauge':            [
      { tag:'circle', attrs:{ cx:12, cy:13, r:8 } },
      { tag:'path', attrs:{ d:'M12 13l4-3M9 7l1 2M15 7l-1 2M5 12l2 1M19 12l-2 1' } },
    ],
    'gear':             [
      { tag:'circle', attrs:{ cx:12, cy:12, r:3 } },
      { tag:'path', attrs:{ d:'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2' } },
    ],
    'oil-drop':         'M12 3l5 9a5 5 0 0 1-10 0z',
    'engine':           [
      { tag:'rect', attrs:{ x:6, y:8, width:12, height:8, rx:1 } },
      { tag:'path', attrs:{ d:'M2 11h4M18 11h4M9 8V5h3v3M14 6h6M14 18h6' } },
    ],
    'snowflake':        'M12 3v18M5 7l14 10M5 17l14-10M3 12h18M9 5l3-2 3 2M9 19l3 2 3-2M5 9l-2 3 2 3M19 9l2 3-2 3',
    'thermometer':      'M14 4a2 2 0 0 0-4 0v10a4 4 0 1 0 4 0z',

    // ════ PARA / İŞ ════
    'money':            [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M12 6v12M9 9h5a2 2 0 0 1 0 4h-4a2 2 0 0 0 0 4h6' } },
    ],
    'banknote':         [
      { tag:'rect', attrs:{ x:3, y:7, width:18, height:10, rx:1 } },
      { tag:'circle', attrs:{ cx:12, cy:12, r:2 } },
      { tag:'path', attrs:{ d:'M6 10v4M18 10v4' } },
    ],
    'credit-card':      [
      { tag:'rect', attrs:{ x:3, y:6, width:18, height:13, rx:2 } },
      { tag:'path', attrs:{ d:'M3 10h18M6 15h2' } },
    ],
    'wallet':           'M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6h-5a2 2 0 0 1 0-4h5V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 1z',
    'receipt':          'M5 21V3l2 2 2-2 2 2 2-2 2 2 2-2 2 2v18l-2-2-2 2-2-2-2 2-2-2-2 2-2-2zM8 8h8M8 12h8M8 16h5',
    'briefcase':        [
      { tag:'rect', attrs:{ x:3, y:7, width:18, height:13, rx:1 } },
      { tag:'path', attrs:{ d:'M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18' } },
    ],
    'calculator':       [
      { tag:'rect', attrs:{ x:5, y:3, width:14, height:18, rx:1 } },
      { tag:'path', attrs:{ d:'M5 9h14M9 13v0M12 13v0M15 13v0M9 17v0M12 17v0M15 17v0M9 6h6' } },
    ],
    'trending-up':      'M3 17l6-6 4 4 8-8M14 7h7v7',
    'trending-down':    'M3 7l6 6 4-4 8 8M14 17h7v-7',
    'percent':          [
      { tag:'circle', attrs:{ cx:7, cy:7, r:2 } },
      { tag:'circle', attrs:{ cx:17, cy:17, r:2 } },
      { tag:'path', attrs:{ d:'M5 19L19 5' } },
    ],

    // ════ GRAFİK ════
    'chart-bar':        'M4 20V8M10 20V4M16 20v-8M22 20H2',
    'chart-line':       'M3 17l5-7 4 4 8-9M21 5h-3v3',
    'chart-pie':        [
      { tag:'path', attrs:{ d:'M21 12a9 9 0 1 1-9-9v9z' } },
      { tag:'path', attrs:{ d:'M21 12A9 9 0 0 0 12 3' } },
    ],
    'activity':         'M22 12h-4l-3 9-6-18-3 9H2',

    // ════ KONUM / HARİTA ════
    'map':              'M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2zM9 4v16M15 6v16',
    'map-pin':          [
      { tag:'path', attrs:{ d:'M12 22s-8-7-8-13a8 8 0 1 1 16 0c0 6-8 13-8 13z' } },
      { tag:'circle', attrs:{ cx:12, cy:9, r:3 } },
    ],
    'pin':              'M12 22V12M9 5h6l-1 7H10z',
    'pin-filled':       [
      { tag:'path', attrs:{ d:'M12 22V12', 'stroke-linecap':'round' } },
      { tag:'path', attrs:{ d:'M9 5h6l-1 7H10z', fill:'currentColor' } },
    ],
    'target':           [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'circle', attrs:{ cx:12, cy:12, r:5 } },
      { tag:'circle', attrs:{ cx:12, cy:12, r:1.5, fill:'currentColor' } },
    ],
    'globe':            [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' } },
    ],
    'milestone':        'M5 22V11M5 11l3-2-3-2V3h12l3 4-3 4z',
    'crosshair':        [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M12 3v3M12 18v3M3 12h3M18 12h3' } },
    ],

    // ════ ZAMAN ════
    'calendar':         [
      { tag:'rect', attrs:{ x:3, y:5, width:18, height:16, rx:1 } },
      { tag:'path', attrs:{ d:'M3 9h18M8 3v4M16 3v4' } },
    ],
    'calendar-month':   [
      { tag:'rect', attrs:{ x:3, y:5, width:18, height:16, rx:1 } },
      { tag:'path', attrs:{ d:'M3 9h18M8 3v4M16 3v4M7 13h2M11 13h2M15 13h2M7 17h2M11 17h2M15 17h2' } },
    ],
    'calendar-check':   [
      { tag:'rect', attrs:{ x:3, y:5, width:18, height:16, rx:1 } },
      { tag:'path', attrs:{ d:'M3 9h18M8 3v4M16 3v4M9 14l2 2 4-4' } },
    ],
    'today':            [
      { tag:'rect', attrs:{ x:3, y:5, width:18, height:16, rx:1 } },
      { tag:'path', attrs:{ d:'M3 9h18M8 3v4M16 3v4' } },
      { tag:'circle', attrs:{ cx:12, cy:15, r:2, fill:'currentColor' } },
    ],
    'clock':            [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M12 7v5l3 2' } },
    ],
    'timer':            [
      { tag:'circle', attrs:{ cx:12, cy:13, r:8 } },
      { tag:'path', attrs:{ d:'M9 3h6M12 9v4M19 7l-2 2' } },
    ],
    'history':          'M3 12a9 9 0 1 0 4-7L3 8M3 3v5h5M12 7v5l3 2',
    'hourglass':        'M6 3h12M6 21h12M7 3v5l5 4-5 4v5M17 3v5l-5 4 5 4v5',

    // ════ UYARI / DURUM ════
    'alert-triangle':   'M12 4l10 17H2zM12 10v5M12 18v.01',
    'alert-circle':     [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M12 8v5M12 16v.01' } },
    ],
    'alert-octagon':    'M8 3h8l5 5v8l-5 5H8l-5-5V8zM12 8v5M12 16v.01',
    'info':             [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M12 16v-5M12 8v.01' } },
    ],
    'help-circle':      [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-1 .5-1 1.2-1 2.2M12 17v.01' } },
    ],
    'shield':           'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z',
    'shield-check':     'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6zM9 12l2 2 4-4',
    'siren':            'M5 12a7 7 0 0 1 14 0v6H5zM12 2v3M3 18h18M5 8L2 6M19 8l3-2',
    'flame':            'M12 21c-5 0-7-4-7-7 0-3 2-6 6-9 0 4 3 5 3 8 2-1 3-1 4 1 1 3-1 7-6 7z',
    'flag':             'M5 21V5a8 8 0 0 1 14 0L5 8',
    'flag-finish':      'M5 21V4M5 4h14l-3 5 3 5H5',

    // ════ DOWNLOAD / UPLOAD ════
    'download':         'M12 3v13M7 12l5 5 5-5M5 21h14',
    'upload':           'M12 21V8M7 12l5-5 5 5M5 3h14',
    'cloud-download':   'M8 17a5 5 0 1 1 1-10 6 6 0 0 1 11 2 4 4 0 0 1 0 8M12 13v8M9 18l3 3 3-3',
    'cloud-upload':     'M8 17a5 5 0 1 1 1-10 6 6 0 0 1 11 2 4 4 0 0 1 0 8M12 21v-8M9 16l3-3 3 3',
    'export':           'M12 3v9M9 7l3-4 3 4M5 14v6h14v-6',
    'import':           'M12 12V3M9 8l3 4 3-4M5 14v6h14v-6',
    'share':            [
      { tag:'circle', attrs:{ cx:18, cy:5, r:3 } },
      { tag:'circle', attrs:{ cx:6, cy:12, r:3 } },
      { tag:'circle', attrs:{ cx:18, cy:19, r:3 } },
      { tag:'path', attrs:{ d:'M8.5 10.5L15.5 6.5M8.5 13.5L15.5 17.5' } },
    ],

    // ════ ETKİLEŞİM / SOSYAL ════
    'heart':            'M20 8a5 5 0 0 0-8-3 5 5 0 0 0-8 6c0 4 8 10 8 10s8-6 8-10z',
    'heart-filled':     [{ tag:'path', attrs:{ d:'M20 8a5 5 0 0 0-8-3 5 5 0 0 0-8 6c0 4 8 10 8 10s8-6 8-10z', fill:'currentColor' } }],
    'star':             'M12 3l3 6 6 1-4 4 1 7-6-3-6 3 1-7-4-4 6-1z',
    'star-filled':      [{ tag:'path', attrs:{ d:'M12 3l3 6 6 1-4 4 1 7-6-3-6 3 1-7-4-4 6-1z', fill:'currentColor' } }],
    'bookmark':         'M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-4z',
    'bookmark-filled':  [{ tag:'path', attrs:{ d:'M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-4z', fill:'currentColor' } }],
    'thumb-up':         'M7 21V11M7 11l4-7a2 2 0 0 1 2 2v4h6a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 2H7M3 11h4v10H3z',
    'handshake':        'M3 13h2l4 4 2-2-3-3 5-5 4 4h2M11 7l5 5M3 11l4 4',
    'trophy':           'M7 4h10v3a5 5 0 0 1-10 0zM3 4h4v3a3 3 0 0 1-3-3zM21 4h-4v3a3 3 0 0 0 3-3zM10 14h4v3h-4zM8 21h8v-2H8z',
    'award':            [
      { tag:'circle', attrs:{ cx:12, cy:9, r:6 } },
      { tag:'path', attrs:{ d:'M9 14l-2 7 5-3 5 3-2-7' } },
    ],
    'party':            'M3 21l4-13 11 11zM7 8l4-4M11 4l3 3M14 7l3-3M21 14l-3-3M18 11l3-3',
    'rocket':           'M5 19l3-3M5 19l-2-2 5-5M19 5l-7 7M19 5l-2 7M19 5l-5-2M14 12a4 4 0 1 1 5-5M9 15l-2 2 1 3 3 1 2-2',

    // ════ DİĞER ════
    'apps-grid':        'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    'sun':              [
      { tag:'circle', attrs:{ cx:12, cy:12, r:4 } },
      { tag:'path', attrs:{ d:'M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2' } },
    ],
    'moon':             'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10z',
    'lightbulb':        'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10c1 1 1 2 1 3h6c0-1 0-2 1-3a6 6 0 0 0-4-10z',
    'zap':              'M13 3L4 14h7l-1 7 9-11h-7z',
    'sparkles':         'M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5zM5 17l.7 2 2 .7-2 .7L5 23l-.7-2-2-.7 2-.7zM19 16l.5 1.5L21 18l-1.5.5L19 20l-.5-1.5L17 18l1.5-.5z',
    'magic':            'M15 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM21 9l.5 1 1 .5-1 .5L21 12l-.5-1-1-.5 1-.5zM4 11L13 20',
    'tag':              [
      { tag:'path', attrs:{ d:'M12 3l9 9-8 8-9-9V3z' } },
      { tag:'circle', attrs:{ cx:8, cy:8, r:1.2, fill:'currentColor' } },
    ],
    'tag-multiple':     [
      { tag:'path', attrs:{ d:'M9 5l9 9-7 7-9-9V5z' } },
      { tag:'path', attrs:{ d:'M14 5l9 9-7 7' } },
      { tag:'circle', attrs:{ cx:6, cy:8, r:1.2, fill:'currentColor' } },
    ],
    'inbox':            'M21 13l-5 8H8l-5-8M3 13h6l1 3h4l1-3h6M3 13l3-9h12l3 9',
    'archive':          [
      { tag:'rect', attrs:{ x:3, y:5, width:18, height:4, rx:0.5 } },
      { tag:'path', attrs:{ d:'M5 9v11h14V9M10 13h4' } },
    ],
    'folder':           'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    'folder-open':      'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3zM3 9h18l-2 8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    'database':         [
      { tag:'ellipse', attrs:{ cx:12, cy:5, rx:8, ry:3 } },
      { tag:'path', attrs:{ d:'M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6' } },
    ],
    'server':           [
      { tag:'rect', attrs:{ x:3, y:4, width:18, height:7, rx:1 } },
      { tag:'rect', attrs:{ x:3, y:13, width:18, height:7, rx:1 } },
      { tag:'circle', attrs:{ cx:7, cy:7.5, r:0.8, fill:'currentColor' } },
      { tag:'circle', attrs:{ cx:7, cy:16.5, r:0.8, fill:'currentColor' } },
    ],
    'broom':            'M5 21l5-5 4 4-5 5zM10 16l4-4M14 12l5-5 2 2-5 5M14 12l4 4',
    'cleaning':         'M9 21l3-9M15 21l-3-9M3 12h18l-2 9H5z',
    'eraser':           'M5 19l8-8 6 6-8 8H5zM10 14l5 5',
    'sticker':          'M3 12a9 9 0 1 1 9 9V12z',

    // ════ FLEETLY MARKA ════
    'fleetly-mark':     [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9, fill:'currentColor' } },
      { tag:'circle', attrs:{ cx:8.5, cy:8.5, r:2.5, fill:'#faf7f0' } },
      { tag:'path', attrs:{ d:'M7 12a5 5 0 0 0 10 0', fill:'none', stroke:'#faf7f0', 'stroke-width':1.5 } },
    ],
    'fleetly':          [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9, fill:'currentColor' } },
      { tag:'circle', attrs:{ cx:8.5, cy:8.5, r:2.5, fill:'#faf7f0' } },
      { tag:'path', attrs:{ d:'M7 12a5 5 0 0 0 10 0', fill:'none', stroke:'#faf7f0', 'stroke-width':1.5 } },
    ],

    // ════ KARAKTERİSTİK SAFETY ════
    'no-entry':         [
      { tag:'circle', attrs:{ cx:12, cy:12, r:9 } },
      { tag:'path', attrs:{ d:'M5 12h14' } },
    ],
    'traffic-light':    [
      { tag:'rect', attrs:{ x:8, y:3, width:8, height:18, rx:4 } },
      { tag:'circle', attrs:{ cx:12, cy:8, r:1.5, fill:'currentColor' } },
      { tag:'circle', attrs:{ cx:12, cy:12, r:1.5 } },
      { tag:'circle', attrs:{ cx:12, cy:16, r:1.5 } },
      { tag:'path', attrs:{ d:'M12 1v2M12 21v2' } },
    ],
    'warning-cone':     'M5 21l3-13a1.5 1.5 0 0 1 3 0l3 13zM3 21h18M7 13h6',
  };

  // ── ALİAS'LAR — emoji'den isim çevirisi ──
  const ALIAS = {
    // emoji → kanonik isim
    '✓': 'check',         '✗': 'x',           '✕': 'x',           '✎': 'edit',
    '✏': 'edit',          '✅': 'check',      '❌': 'x',           '➕': 'plus',
    '⚠': 'alert-triangle','✉': 'mail',         '⚓': 'anchor',
    '⚙': 'settings',      '⚡': 'zap',         '★': 'star-filled',
    '❄': 'snowflake',     '⚖': 'percent',
    '📋': 'clipboard',    '📊': 'chart-bar',   '📈': 'trending-up','📉': 'trending-down',
    '📊': 'chart-bar',    '📌': 'pin',         '📍': 'map-pin',
    '📅': 'calendar',     '🗓': 'calendar-month','📆': 'calendar',
    '📦': 'container',    '📤': 'export',      '📥': 'import',
    '📐': 'sliders',      '📏': 'sliders',     '📎': 'paperclip',
    '📞': 'phone',        '📧': 'mail',        '📨': 'mail',       '📲': 'phone-android',
    '📷': 'camera',       '📸': 'camera',      '📱': 'phone-android',
    '📝': 'note',         '📄': 'file-text',   '📜': 'description','📃': 'description',
    '📂': 'folder',       '📁': 'folder',      '🗂': 'folder-open',
    '📑': 'description',  '📘': 'file-text',   '📕': 'file-text',
    '📊': 'chart-bar',    '📢': 'megaphone',
    '🔍': 'search',       '🔎': 'search',      '🔒': 'lock',       '🔓': 'unlock',
    '🔐': 'lock',         '🔑': 'key',         '🔗': 'link',       '🔔': 'bell',
    '🔕': 'bell-off',     '🔧': 'wrench',      '🔨': 'tools',      '🔩': 'screwdriver',
    '🛠': 'tools',        '🛞': 'wheel',       '🛣': 'road',       '🛡': 'shield',
    '🚛': 'truck',        '🚚': 'truck',       '🚐': 'truck',      '🚗': 'truck',
    '🚙': 'truck',        '🚌': 'truck',       '🚔': 'truck',      '🛻': 'truck',
    '🚢': 'ship',         '🚦': 'traffic-light','🚧': 'warning-cone',
    '🚨': 'siren',        '🚫': 'ban',         '🚪': 'log-out',    '🚏': 'milestone',
    '🚀': 'rocket',       '🚉': 'building',
    '🏠': 'home',         '🏢': 'building',    '🏨': 'building',
    '🏭': 'factory',      '🏥': 'building',    '🏦': 'building',   '🏗': 'building',
    '🏁': 'flag-finish',  '🏆': 'trophy',
    '👤': 'user',         '👥': 'users',       '👨': 'user',       '👩': 'user',
    '👋': 'wave',         '👈': 'chevron-left','👉': 'chevron-right',
    '👍': 'thumb-up',     '🤝': 'handshake',   '🪪': 'credit-card',
    '💰': 'money',        '💵': 'banknote',    '💸': 'banknote',   '💳': 'credit-card',
    '💼': 'briefcase',    '💬': 'message-circle','💭': 'message-circle',
    '💡': 'lightbulb',    '💾': 'save',        '💎': 'sparkles',
    '🕐': 'clock',        '🕒': 'clock',       '⏰': 'clock',      '⏱': 'timer',
    '🗺': 'map',          '🗑': 'trash',       '🗒': 'note',       '🗓': 'calendar-month',
    '🎯': 'target',       '🎉': 'party',       '🎨': 'sparkles',   '🎬': 'apps',
    '🎛': 'sliders',      '🧮': 'calculator',  '🧭': 'compass',    '🧠': 'lightbulb',
    '🧹': 'broom',        '🅿': 'parking',
    '🌐': 'globe',        '🌍': 'globe',       '🔥': 'flame',
    '🔄': 'refresh',      '🔃': 'refresh',     '🔁': 'refresh',
    '📡': 'globe',        '📶': 'activity',
    '🟢': 'circle-filled','🔴': 'circle-filled','🟡': 'circle-filled',
    '🟠': 'circle-filled','🔵': 'circle-filled','⚫': 'circle-filled',
    '🔲': 'circle',       '◯': 'circle',
    '✈': 'send',          '✍': 'edit',         '👁': 'eye',
    '🔖': 'bookmark',     '❤': 'heart-filled',
    '🍪': 'circle',       '🍽': 'circle',
    '🆕': 'sparkles',     '🛏': 'home',        '🛑': 'no-entry',
    '🔵': 'circle',       '☰': 'menu',
    '🇹': 'flag',         '🇷': 'flag',
    '🫧': 'sparkles',     '🪪': 'credit-card',
  };

  // ── SVG ÜRETİMİ ──
  const NS = 'http://www.w3.org/2000/svg';
  const DEFAULT_ATTRS = {
    'viewBox': '0 0 24 24',
    'fill': 'none',
    'stroke': 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };

  function resolveName(input) {
    if (!input) return null;
    if (ICONS[input]) return input;
    if (ALIAS[input]) return ALIAS[input];
    return null;
  }

  function buildSVG(name, opts) {
    opts = opts || {};
    const def = ICONS[name];
    if (!def) return null;

    const svg = document.createElementNS(NS, 'svg');
    Object.entries(DEFAULT_ATTRS).forEach(([k, v]) => svg.setAttribute(k, v));
    svg.classList.add('fl-icon');
    if (opts.class) opts.class.split(/\s+/).forEach(c => c && svg.classList.add(c));
    if (opts.size != null) {
      svg.setAttribute('width',  String(opts.size));
      svg.setAttribute('height', String(opts.size));
    }
    if (opts.title) {
      const t = document.createElementNS(NS, 'title');
      t.textContent = opts.title;
      svg.appendChild(t);
    }
    svg.setAttribute('data-icon-name', name);

    // String → tek <path>
    if (typeof def === 'string') {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', def);
      svg.appendChild(p);
    } else if (Array.isArray(def)) {
      def.forEach(part => {
        const el = document.createElementNS(NS, part.tag);
        Object.entries(part.attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v)));
        svg.appendChild(el);
      });
    }
    return svg;
  }

  // ── HTML STRING ÜRETİMİ (PDF/SSR için) ──
  function buildHTML(name, opts) {
    opts = opts || {};
    const def = ICONS[name];
    if (!def) return '';
    const attrs = Object.assign({}, DEFAULT_ATTRS, {
      'class': ('fl-icon ' + (opts.class || '')).trim(),
      'data-icon-name': name,
    });
    if (opts.size != null) { attrs.width = String(opts.size); attrs.height = String(opts.size); }
    const attrStr = Object.entries(attrs).map(([k,v]) => `${k}="${esc(v)}"`).join(' ');
    let inner = '';
    if (typeof def === 'string') {
      inner = `<path d="${esc(def)}"/>`;
    } else if (Array.isArray(def)) {
      inner = def.map(part => {
        const a = Object.entries(part.attrs || {}).map(([k,v]) => `${k}="${esc(v)}"`).join(' ');
        return `<${part.tag} ${a}/>`;
      }).join('');
    }
    const titleHtml = opts.title ? `<title>${esc(opts.title)}</title>` : '';
    return `<svg ${attrStr}>${titleHtml}${inner}</svg>`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, ch => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]
    ));
  }

  // ── DOM auto-replace ──
  function _replaceNode(el) {
    const name = resolveName(el.getAttribute('data-icon'));
    if (!name) return;
    const size = el.getAttribute('data-icon-size');
    const title = el.getAttribute('title') || el.getAttribute('aria-label');
    const cls = el.getAttribute('class') || '';
    const svg = buildSVG(name, {
      size: size ? Number(size) : null,
      title,
      class: cls,
    });
    if (!svg) return;
    // Yedek: orijinal class ve data-* attribute'ları kalsın
    Array.from(el.attributes).forEach(attr => {
      if (attr.name === 'class' || attr.name === 'data-icon' || attr.name === 'data-icon-size') return;
      svg.setAttribute(attr.name, attr.value);
    });
    el.replaceWith(svg);
  }

  function replaceAll(root) {
    root = root || document;
    root.querySelectorAll('[data-icon]').forEach(_replaceNode);
  }

  // CSS enjeksiyonu
  function injectStyle() {
    if (document.getElementById('fl-icon-style')) return;
    const s = document.createElement('style');
    s.id = 'fl-icon-style';
    s.textContent = `
      .fl-icon { display:inline-block; width:1em; height:1em; vertical-align:-0.125em; flex-shrink:0; }
      .fl-icon[width][height] { width:auto; height:auto; }
      .fl-icon-lg { width:1.25em; height:1.25em; }
      .fl-icon-xl { width:1.5em; height:1.5em; }
      .fl-icon-2x { width:2em; height:2em; }
      .fl-icon-spin { animation: fl-icon-spin 1s linear infinite; }
      @keyframes fl-icon-spin { to { transform: rotate(360deg); } }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  // Init: DOMContentLoaded'dan sonra otomatik
  function init() {
    injectStyle();
    replaceAll(document);
    // Dinamik içerik için MutationObserver
    if (window.MutationObserver) {
      const mo = new MutationObserver(muts => {
        muts.forEach(m => {
          m.addedNodes && m.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            if (node.matches && node.matches('[data-icon]')) _replaceNode(node);
            if (node.querySelectorAll) node.querySelectorAll('[data-icon]').forEach(_replaceNode);
          });
        });
      });
      mo.observe(document.documentElement, { childList:true, subtree:true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once:true });
  } else {
    init();
  }

  // Public API
  window.FleetlyIcons = {
    PATHS: ICONS,
    ALIAS: ALIAS,
    svg: buildSVG,
    html: buildHTML,
    exists: name => !!resolveName(name),
    resolve: resolveName,
    replaceAll: replaceAll,
    inject: injectStyle,
  };
})();
