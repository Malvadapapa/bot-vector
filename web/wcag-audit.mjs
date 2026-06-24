// WCAG 2.1 Contrast Ratio Audit Script
// Checks all theme palettes for text contrast compliance

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function sRGBtoLinear(c) {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]) {
  return 0.2126 * sRGBtoLinear(r) + 0.7152 * sRGBtoLinear(g) + 0.0722 * sRGBtoLinear(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = luminance(hexToRgb(hex1));
  const l2 = luminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function wcagLevel(ratio) {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA-Large';
  return 'FAIL';
}

// ═══════════════════════════════════════════════════
// Define ALL themes with their key color variables
// ═══════════════════════════════════════════════════

const themes = {
  'Default (WhatsApp Dark)': {
    type: 'dark',
    bgPrimary: '#0a0e17', bgSecondary: '#111827', bgTertiary: '#1a2332',
    bgCard: '#151f2e', bgCardHover: '#1c2840', bgInput: '#0f1724',
    bgApp: '#0b1120', bgSidebar: '#0d1526', bgSidebarFooter: '#0a0f1d',
    accent: '#10b981', accentHover: '#059669', accentLight: '#34d399',
    secondary: '#8b5cf6', secondaryLight: '#a78bfa',
    textPrimary: '#f1f5f9', textSecondary: '#94a3b8', textTertiary: '#64748b',
    textInverse: '#0f172a', textAccent: '#34d399', textDanger: '#fca5a5',
    border: '#557093', borderHover: '#6c8ab2',
    danger: '#ef4444', warning: '#f59e0b', info: '#3b82f6', success: '#10b981',
  },
  'Nord Dark': {
    type: 'dark',
    bgPrimary: '#0f172a', bgSecondary: '#1e293b', bgTertiary: '#334155',
    bgCard: '#1e293b', bgCardHover: '#334155', bgInput: '#0f172a',
    bgApp: '#0f172a', bgSidebar: '#1e293b', bgSidebarFooter: '#0f172a',
    accent: '#5c5feb', accentHover: '#4f46e5', accentLight: '#818cf8',
    secondary: '#06b6d4', secondaryLight: '#67e8f9',
    textPrimary: '#f1f5f9', textSecondary: '#94a3b8', textTertiary: '#8899aa',
    textInverse: '#ffffff', textAccent: '#818cf8', textDanger: '#fca5a5',
    border: '#778fa9', borderHover: '#8fa8c4',
    danger: '#ef4444', warning: '#f59e0b', info: '#3b82f6', success: '#10b981',
  },
  'Midnight Purple': {
    type: 'dark',
    bgPrimary: '#030712', bgSecondary: '#0b0f19', bgTertiary: '#1f1b2e',
    bgCard: '#0f111a', bgCardHover: '#1f1235', bgInput: '#05070c',
    bgApp: '#030712', bgSidebar: '#0b0f19', bgSidebarFooter: '#030712',
    accent: '#a855f7', accentHover: '#9333ea', accentLight: '#c084fc',
    secondary: '#db2777', secondaryLight: '#f472b6',
    textPrimary: '#f1f5f9', textSecondary: '#94a3b8', textTertiary: '#64748b',
    textInverse: '#0f172a', textAccent: '#c084fc', textDanger: '#fca5a5',
    border: '#5f6692', borderHover: '#747ba9',
    danger: '#ef4444', warning: '#f59e0b', info: '#3b82f6', success: '#10b981',
  },
  'Emerald Light': {
    type: 'light',
    bgPrimary: '#f8fafc', bgSecondary: '#f1f5f9', bgTertiary: '#e2e8f0',
    bgCard: '#ffffff', bgCardHover: '#f8fafc', bgInput: '#ffffff',
    bgApp: '#f8fafc', bgSidebar: '#f1f5f9', bgSidebarFooter: '#e2e8f0',
    accent: '#047857', accentHover: '#065f46', accentLight: '#10b981',
    secondary: '#7c3aed', secondaryLight: '#7c3aed',
    textPrimary: '#0f172a', textSecondary: '#475569', textTertiary: '#64748b',
    textInverse: '#ffffff', textAccent: '#047857', textDanger: '#dc2626',
    border: '#6b7d90', borderHover: '#536275',
    danger: '#dc2626', warning: '#b45309', info: '#2563eb', success: '#047857',
  },
  'Oceanic Light': {
    type: 'light',
    bgPrimary: '#f0f4f8', bgSecondary: '#e2ecf5', bgTertiary: '#d0e1f0',
    bgCard: '#ffffff', bgCardHover: '#f0f4f8', bgInput: '#ffffff',
    bgApp: '#f0f4f8', bgSidebar: '#e2ecf5', bgSidebarFooter: '#d0e1f0',
    accent: '#2563eb', accentHover: '#1d4ed8', accentLight: '#60a5fa',
    secondary: '#0369a1', secondaryLight: '#0ea5e9',
    textPrimary: '#0f172a', textSecondary: '#334155', textTertiary: '#64748b',
    textInverse: '#ffffff', textAccent: '#1d4ed8', textDanger: '#dc2626',
    border: '#6b7d90', borderHover: '#536275',
    danger: '#dc2626', warning: '#b45309', info: '#2563eb', success: '#047857',
  },
  'Urban Light (Diagramación Urbana)': {
    type: 'light',
    bgPrimary: '#F0DED0', bgSecondary: '#E1C49C', bgTertiary: '#B3C7E0',
    bgCard: '#ffffff', bgCardHover: '#faf5f0', bgInput: '#ffffff',
    bgApp: '#F0DED0', bgSidebar: '#B3C7E0', bgSidebarFooter: '#9fb5d0',
    accent: '#345288', accentHover: '#273e67', accentLight: '#4c6fa8',
    secondary: '#C58D5C', secondaryLight: '#db9d6d',
    textPrimary: '#345288', textSecondary: '#273e67', textTertiary: '#405880',
    textInverse: '#ffffff', textAccent: '#345288', textDanger: '#dc2626',
    border: '#92603c', borderHover: '#7b4f30',
    danger: '#dc2626', warning: '#b45309', info: '#2563eb', success: '#047857',
  },
  'Hillside Dark (Monocromática Cálida)': {
    type: 'dark',
    bgPrimary: '#45372c', bgSecondary: '#392c22', bgTertiary: '#2e2219',
    bgCard: '#524235', bgCardHover: '#5d4c3d', bgInput: '#392c22',
    bgApp: '#45372c', bgSidebar: '#2e2219', bgSidebarFooter: '#251b14',
    accent: '#EED9BE', accentHover: '#fff3e3', accentLight: '#f6e5cd',
    secondary: '#C7AB96', secondaryLight: '#e4d1c3',
    textPrimary: '#F2E6D9', textSecondary: '#D4B896', textTertiary: '#c2a286',
    textInverse: '#2e2219', textAccent: '#EED9BE', textDanger: '#fca5a5',
    border: '#b69a82', borderHover: '#d4b79e',
    danger: '#ef4444', warning: '#f59e0b', info: '#3b82f6', success: '#10b981',
  },
  'Nordic Accent (Gris Azulado)': {
    type: 'dark',
    bgPrimary: '#253341', bgSecondary: '#1a2530', bgTertiary: '#131b23',
    bgCard: '#344454', bgCardHover: '#3d4f62', bgInput: '#1a2530',
    bgApp: '#253341', bgSidebar: '#1a2530', bgSidebarFooter: '#131b23',
    accent: '#DC9D68', accentHover: '#ebb68c', accentLight: '#f2c7a5',
    secondary: '#A0B3C2', secondaryLight: '#d1dce5',
    textPrimary: '#D6DDE3', textSecondary: '#b0c1cf', textTertiary: '#94a7b7',
    textInverse: '#1a2530', textAccent: '#DC9D68', textDanger: '#fca5a5',
    border: '#8ca3b8', borderHover: '#a3b7c8',
    danger: '#ef4444', warning: '#f59e0b', info: '#3b82f6', success: '#10b981',
  },
};

// ═══════════════════════════════════════════════════
// Run Audit
// ═══════════════════════════════════════════════════

let totalFailures = 0;
const failures = [];

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  WCAG 2.1 CONTRAST AUDIT — ALL THEMES                  ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

for (const [themeName, t] of Object.entries(themes)) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${themeName} (${t.type})`);
  console.log(`${'═'.repeat(60)}`);

  const backgrounds = [
    ['bgPrimary', t.bgPrimary], ['bgSecondary', t.bgSecondary],
    ['bgTertiary', t.bgTertiary], ['bgCard', t.bgCard],
    ['bgInput', t.bgInput], ['bgSidebar', t.bgSidebar],
  ];

  const textColors = [
    ['textPrimary', t.textPrimary], ['textSecondary', t.textSecondary],
    ['textTertiary', t.textTertiary], ['textAccent', t.textAccent],
  ];

  // 1) Text on backgrounds
  console.log('\n  📝 Text on Backgrounds (min 4.5:1 for AA):');
  for (const [bgName, bgHex] of backgrounds) {
    for (const [txtName, txtHex] of textColors) {
      const ratio = contrastRatio(txtHex, bgHex);
      const level = wcagLevel(ratio);
      const icon = level === 'FAIL' ? '❌' : level === 'AA-Large' ? '⚠️' : '✅';
      const line = `    ${icon} ${txtName} (${txtHex}) on ${bgName} (${bgHex}): ${ratio.toFixed(2)}:1 [${level}]`;
      console.log(line);
      if (level === 'FAIL') {
        totalFailures++;
        failures.push({ theme: themeName, combo: `${txtName} on ${bgName}`, fg: txtHex, bg: bgHex, ratio: ratio.toFixed(2), level });
      }
    }
  }

  // 2) Active sidebar link: textInverse on accent
  console.log('\n  🔗 Active Sidebar Link (textInverse on accent):');
  const activeRatio = contrastRatio(t.textInverse, t.accent);
  const activeLevel = wcagLevel(activeRatio);
  const activeIcon = activeLevel === 'FAIL' ? '❌' : activeLevel === 'AA-Large' ? '⚠️' : '✅';
  console.log(`    ${activeIcon} textInverse (${t.textInverse}) on accent (${t.accent}): ${activeRatio.toFixed(2)}:1 [${activeLevel}]`);
  if (activeLevel === 'FAIL' || activeLevel === 'AA-Large') {
    totalFailures++;
    failures.push({ theme: themeName, combo: 'textInverse on accent (ACTIVE LINK)', fg: t.textInverse, bg: t.accent, ratio: activeRatio.toFixed(2), level: activeLevel });
  }

  // 3) Borders on backgrounds (min 3:1 for §1.4.11)
  console.log('\n  🔲 Borders on Backgrounds (min 3:1 §1.4.11):');
  for (const [bgName, bgHex] of backgrounds) {
    const borderRatio = contrastRatio(t.border, bgHex);
    const borderLevel = borderRatio >= 3 ? 'OK' : 'FAIL';
    const borderIcon = borderLevel === 'FAIL' ? '❌' : '✅';
    console.log(`    ${borderIcon} border (${t.border}) on ${bgName} (${bgHex}): ${borderRatio.toFixed(2)}:1 [${borderLevel}]`);
    if (borderLevel === 'FAIL') {
      totalFailures++;
      failures.push({ theme: themeName, combo: `border on ${bgName}`, fg: t.border, bg: bgHex, ratio: borderRatio.toFixed(2), level: 'BORDER-FAIL' });
    }
  }
}

// ═══════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════
console.log(`\n\n${'█'.repeat(60)}`);
console.log(`█  SUMMARY: ${totalFailures} total issues found`);
console.log(`${'█'.repeat(60)}\n`);

if (failures.length > 0) {
  console.log('ISSUES TO FIX:');
  for (const f of failures) {
    console.log(`  ❌ [${f.theme}] ${f.combo}: ${f.fg} on ${f.bg} = ${f.ratio}:1 (${f.level})`);
  }
} else {
  console.log('✅ All combinations pass WCAG requirements!');
}
