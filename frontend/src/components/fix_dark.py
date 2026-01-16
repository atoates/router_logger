import re

with open('DashboardV3.js', 'r') as f:
    content = f.read()

# Replace all dark mode ternaries with dark values
replacements = [
    (r"stroke=\{dark\?'#334155':'#e5e7eb'\}", "stroke='#334155'"),
    (r"fill:\s*dark\?'#cbd5e1':'#475569'", "fill: '#cbd5e1'"),
    (r"backgroundColor:\s*dark\s*\?\s*'#1f2937'\s*:\s*'#ffffff'", "backgroundColor: '#1f2937'"),
    (r"border:\s*'1px solid '\s*\+\s*\(dark\s*\?\s*'#374151'\s*:\s*'#e5e7eb'\)", "border: '1px solid #374151'"),
    (r"color:\s*dark\s*\?\s*'#e5e7eb'\s*:\s*'#111827'", "color: '#e5e7eb'"),
    (r"const textColor = dark \? '#cbd5e1' : '#1f2937';", "const textColor = '#cbd5e1';"),
    (r"const baseBg = dark \? '#1f2937' : '#e5e7eb';", "const baseBg = '#1f2937';"),
    (r"const hoverBg = dark \? '#374151' : '#d1d5db';", "const hoverBg = '#374151';"),
    (r"stroke=\{dark\?'#475569':'#cbd5e1'\}", "stroke='#475569'"),
]

for pattern, replacement in replacements:
    content = re.sub(pattern, replacement, content)

with open('DashboardV3.js', 'w') as f:
    f.write(content)

print("Replaced all dark mode ternaries")
