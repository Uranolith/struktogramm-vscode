'use strict';
// Symbole der Elementtypen – gemeinsam für Editor und Struktograf-Seitenleiste
window.STRUKTO_ICONS = {
  instruction: '<rect x="1.5" y="4.5" width="13" height="7"/>',
  alternative: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M1.5 2.5 L8 8 L14.5 2.5 M1.5 8 H14.5 M8 8 V13.5"/>',
  case: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M1.5 2.5 L11 8 L14.5 2.5 M1.5 8 H14.5 M5 8 V13.5 M8.2 8 V13.5 M11 8 V13.5"/>',
  for: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M5 6 H14.5 M5 6 V13.5"/><circle cx="3.3" cy="10.5" r=".9"/>',
  while: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M5 6 H14.5 M5 6 V13.5"/>',
  repeat: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M5 10 H14.5 M5 2.5 V10"/>',
  forever: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M5 5.5 H14.5 M5 5.5 V11 H14.5"/>',
  call: '<rect x="1.5" y="4.5" width="13" height="7"/><path d="M3.5 4.5 V11.5 M12.5 4.5 V11.5"/>',
  jump: '<rect x="1.5" y="4.5" width="13" height="7"/><path d="M4.5 4.5 L2 8 L4.5 11.5"/>',
  parallel: '<rect x="1.5" y="2.5" width="13" height="11"/><path d="M1.5 5 H14.5 M1.5 11 H14.5 M8 5 V11"/>',
  try: '<rect x="1.5" y="1.5" width="13" height="13"/><path d="M4.5 4 H14.5 M4.5 4 V7.5 H14.5 M4.5 9.5 H14.5 M4.5 9.5 V12.5 H14.5"/>',
};
