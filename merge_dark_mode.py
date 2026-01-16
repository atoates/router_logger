#!/usr/bin/env python3
"""
Script to merge dark-mode CSS rules into base rules and remove dark-mode prefixes.
Since the app is always in dark mode now, we don't need the body.dark-mode selectors.
"""

import re
import sys

def merge_dark_mode_css(css_content):
    """Merge dark-mode rules into base rules"""
    
    # Split into lines for processing
    lines = css_content.split('\n')
    result_lines = []
    i = 0
    
    # Track which base selectors we've already seen
    merged_selectors = set()
    
    while i < len(lines):
        line = lines[i]
        
        # Check if this is a dark-mode rule
        if 'body.dark-mode' in line or '.dark-mode' in line:
            # Extract the selector without body.dark-mode prefix
            selector = re.sub(r'body\.dark-mode\s+', '', line)
            selector = re.sub(r'\.dark-mode\s+', '', selector)
            
            # Collect the rule block
            rule_lines = [selector]
            i += 1
            brace_count = line.count('{') - line.count('}')
            
            while i < len(lines) and (brace_count > 0 or '}' not in lines[i]):
                rule_lines.append(lines[i])
                brace_count += lines[i].count('{') - lines[i].count('}')
                i += 1
                if brace_count <= 0:
                    break
            
            if i < len(lines):
                rule_lines.append(lines[i])
            
            # Check if we should merge this (if the base selector exists earlier)
            base_selector = selector.strip()
            if base_selector not in merged_selectors:
                # Add this as a new rule (it will replace the light mode version)
                result_lines.extend(rule_lines)
                merged_selectors.add(base_selector)
        else:
            # Regular line - check if it's a selector that has a dark-mode override
            # If so, skip it (we'll use the dark mode version)
            if line.strip() and '{' in line and not line.strip().startswith('/*'):
                selector = line.split('{')[0].strip()
                # Check if this selector will be overridden by a dark-mode version
                has_dark_override = False
                for j in range(i + 1, len(lines)):
                    if f'body.dark-mode {selector}' in lines[j] or f'.dark-mode {selector}' in lines[j]:
                        has_dark_override = True
                        break
                    # Stop looking after seeing multiple rules
                    if lines[j].count('{') > 3:
                        break
                
                if not has_dark_override:
                    result_lines.append(line)
                else:
                    # Skip this rule and its block - we'll use the dark version
                    i += 1
                    brace_count = line.count('{') - line.count('}')
                    while i < len(lines) and brace_count > 0:
                        brace_count += lines[i].count('{') - lines[i].count('}')
                        i += 1
                    continue
            else:
                result_lines.append(line)
        
        i += 1
    
    return '\n'.join(result_lines)

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Usage: python merge_dark_mode.py <css_file>")
        sys.exit(1)
    
    css_file = sys.argv[1]
    
    with open(css_file, 'r') as f:
        content = f.read()
    
    merged = merge_dark_mode_css(content)
    
    # Write to output file
    output_file = css_file.replace('.css', '_merged.css')
    with open(output_file, 'w') as f:
        f.write(merged)
    
    print(f"Merged CSS written to {output_file}")
