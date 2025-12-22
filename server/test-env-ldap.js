#!/usr/bin/env node
// server/test-env-ldap.js - Test dan clean .env file
import dotenv from 'dotenv';
import fs from 'fs';

console.log('');
console.log('='.repeat(70));
console.log('🔍 TESTING AND CLEANING .env FILE');
console.log('='.repeat(70));
console.log('');

// Load .env
dotenv.config();

// Test LDAP_SEARCH_FILTER
console.log('1️⃣ Testing LDAP_SEARCH_FILTER');
console.log('-'.repeat(70));

const searchFilter = process.env.LDAP_SEARCH_FILTER || '(sAMAccountName={{username}})';

console.log(`Raw value: "${searchFilter}"`);
console.log(`Length: ${searchFilter.length} characters`);
console.log(`Hex: ${Buffer.from(searchFilter).toString('hex')}`);
console.log('');

// Check for hidden characters
const hasCarriageReturn = searchFilter.includes('\r');
const hasNewline = searchFilter.includes('\n');
const hasTab = searchFilter.includes('\t');
const hasExtraSpaces = searchFilter !== searchFilter.trim();

if (hasCarriageReturn) console.log('⚠️  Contains carriage return (\\r)');
if (hasNewline) console.log('⚠️  Contains newline (\\n)');
if (hasTab) console.log('⚠️  Contains tab (\\t)');
if (hasExtraSpaces) console.log('⚠️  Has leading/trailing spaces');

// Count parentheses
const openCount = (searchFilter.match(/\(/g) || []).length;
const closeCount = (searchFilter.match(/\)/g) || []).length;

console.log(`Open parentheses: ${openCount}`);
console.log(`Close parentheses: ${closeCount}`);

if (openCount !== closeCount) {
  console.log('❌ UNBALANCED PARENTHESES!');
  console.log('');
  console.log('Fixing...');
  
  let fixed = searchFilter.trim();
  
  // Remove extra closing parentheses
  while ((fixed.match(/\)/g) || []).length > (fixed.match(/\(/g) || []).length) {
    const lastIndex = fixed.lastIndexOf(')');
    fixed = fixed.substring(0, lastIndex) + fixed.substring(lastIndex + 1);
  }
  
  // Add missing closing parentheses
  while ((fixed.match(/\(/g) || []).length > (fixed.match(/\)/g) || []).length) {
    fixed = fixed + ')';
  }
  
  console.log(`✅ Fixed filter: "${fixed}"`);
  console.log('');
  console.log('Add this to your .env:');
  console.log(`LDAP_SEARCH_FILTER=${fixed}`);
} else {
  console.log('✅ Parentheses are balanced');
}

console.log('');

// Clean version
const cleaned = searchFilter
  .trim()
  .replace(/\r\n/g, '')
  .replace(/\n/g, '')
  .replace(/\t/g, '')
  .replace(/\s+/g, ' ');

if (cleaned !== searchFilter) {
  console.log('2️⃣ Cleaned Version');
  console.log('-'.repeat(70));
  console.log(`Original: "${searchFilter}"`);
  console.log(`Cleaned:  "${cleaned}"`);
  console.log('');
  console.log('✅ Use this in your .env:');
  console.log(`LDAP_SEARCH_FILTER=${cleaned}`);
  console.log('');
} else {
  console.log('✅ No cleaning needed');
  console.log('');
}

// Test other LDAP vars
console.log('3️⃣ Other LDAP Configuration');
console.log('-'.repeat(70));

const ldapVars = {
  'LDAP_ENABLED': process.env.LDAP_ENABLED,
  'LDAP_URL': process.env.LDAP_URL,
  'LDAP_BIND_DN': process.env.LDAP_BIND_DN,
  'LDAP_BIND_PASSWORD': process.env.LDAP_BIND_PASSWORD ? '***' : undefined,
  'LDAP_SEARCH_BASE': process.env.LDAP_SEARCH_BASE,
  'LDAP_ADMIN_GROUPS': process.env.LDAP_ADMIN_GROUPS
};

Object.entries(ldapVars).forEach(([key, value]) => {
  if (value === undefined) {
    console.log(`❌ ${key}: NOT SET`);
  } else {
    console.log(`✅ ${key}: ${value}`);
  }
});

console.log('');

console.log('='.repeat(70));
console.log('✅ TEST COMPLETE');
console.log('='.repeat(70));
console.log('');

if (openCount !== closeCount || cleaned !== searchFilter) {
  console.log('⚠️  RECOMMENDED ACTIONS:');
  console.log('');
  console.log('1. Open your .env file');
  console.log('2. Find the line: LDAP_SEARCH_FILTER=...');
  console.log('3. Replace it with:');
  console.log(`   LDAP_SEARCH_FILTER=${cleaned !== searchFilter ? cleaned : searchFilter}`);
  console.log('4. Save and restart the server');
  console.log('');
} else {
  console.log('✅ Your .env file looks good!');
  console.log('');
}
