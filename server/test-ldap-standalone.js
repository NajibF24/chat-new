// test-ldap-standalone.js - Standalone LDAP Test (no dependencies)
import ldap from 'ldapjs';

// ✅ Configuration (ganti sesuai .env Anda)
const LDAP_URL = 'ldap://172.16.21.100:389';
const BIND_DN = 'CN=Git Developer,OU=Account IT,DC=gyssteel,DC=com';
const BIND_PASSWORD = 'EqualAngles@2025';
const SEARCH_BASE = 'DC=gyssteel,DC=com';
const TEST_USERNAME = process.argv[2] || 'testuser'; // Ambil dari argument

// ✅ CRITICAL: Filter yang benar
const SEARCH_FILTER_TEMPLATE = '(sAMAccountName={{username}})';

console.log('');
console.log('='.repeat(70));
console.log('🧪 STANDALONE LDAP CONNECTION TEST');
console.log('='.repeat(70));
console.log('');
console.log('📋 Configuration:');
console.log(`   URL: ${LDAP_URL}`);
console.log(`   Bind DN: ${BIND_DN}`);
console.log(`   Search Base: ${SEARCH_BASE}`);
console.log(`   Filter Template: ${SEARCH_FILTER_TEMPLATE}`);
console.log(`   Test Username: ${TEST_USERNAME}`);
console.log('');

// Test 1: Connection
console.log('1️⃣ Testing connection...');
const client = ldap.createClient({
  url: LDAP_URL,
  timeout: 5000,
  connectTimeout: 10000
});

client.bind(BIND_DN, BIND_PASSWORD, (bindErr) => {
  if (bindErr) {
    console.log('   ❌ Bind failed:', bindErr.message);
    console.log('');
    console.log('Possible issues:');
    console.log('   - Wrong Bind DN or password');
    console.log('   - LDAP server not reachable');
    console.log('   - Firewall blocking connection');
    process.exit(1);
  }
  
  console.log('   ✅ Bind successful!');
  console.log('');
  
  // Test 2: Search user
  console.log('2️⃣ Searching for user...');
  
  // Build filter
  const searchFilter = SEARCH_FILTER_TEMPLATE.replace(/\{\{username\}\}/g, TEST_USERNAME);
  console.log(`   Using filter: ${searchFilter}`);
  console.log('');
  
  // Check for extra parentheses
  const openCount = (searchFilter.match(/\(/g) || []).length;
  const closeCount = (searchFilter.match(/\)/g) || []).length;
  
  if (openCount !== closeCount) {
    console.log('   ⚠️  WARNING: Unbalanced parentheses detected!');
    console.log(`      Open: ${openCount}, Close: ${closeCount}`);
    console.log('      This might cause "Filter Parsing Error"');
    console.log('');
  }
  
  const opts = {
    filter: searchFilter,
    scope: 'sub',
    attributes: [
      'sAMAccountName',
      'mail',
      'cn',
      'displayName',
      'givenName',
      'sn',
      'memberOf',
      'department',
      'title',
      'dn'
    ]
  };
  
  client.search(SEARCH_BASE, opts, (searchErr, res) => {
    if (searchErr) {
      console.log('   ❌ Search failed:', searchErr.message);
      client.unbind();
      process.exit(1);
    }
    
    let found = false;
    
    res.on('searchEntry', (entry) => {
      found = true;
      console.log('   ✅ User found!');
      console.log('');
      console.log('   User Details:');
      console.log(`      DN: ${entry.object.dn}`);
      console.log(`      Username: ${entry.object.sAMAccountName}`);
      console.log(`      Display Name: ${entry.object.cn || entry.object.displayName}`);
      console.log(`      Email: ${entry.object.mail || 'N/A'}`);
      console.log(`      First Name: ${entry.object.givenName || 'N/A'}`);
      console.log(`      Last Name: ${entry.object.sn || 'N/A'}`);
      console.log(`      Department: ${entry.object.department || 'N/A'}`);
      console.log(`      Title: ${entry.object.title || 'N/A'}`);
      
      if (entry.object.memberOf) {
        const groups = Array.isArray(entry.object.memberOf) 
          ? entry.object.memberOf 
          : [entry.object.memberOf];
        
        console.log(`      Groups (${groups.length}):`);
        groups.slice(0, 5).forEach(g => {
          const match = g.match(/^CN=([^,]+)/i);
          const groupName = match ? match[1] : g;
          console.log(`         - ${groupName}`);
        });
        
        if (groups.length > 5) {
          console.log(`         ... and ${groups.length - 5} more`);
        }
      }
    });
    
    res.on('error', (err) => {
      console.log('   ❌ Search error:', err.message);
      
      if (err.message.includes('Filter Parsing Error')) {
        console.log('');
        console.log('   🔍 Diagnosis: LDAP Filter has syntax error!');
        console.log('');
        console.log('   Your filter: ' + searchFilter);
        console.log('   Expected:    (sAMAccountName=' + TEST_USERNAME + ')');
        console.log('');
        console.log('   Common causes:');
        console.log('      - Extra closing parenthesis: (sAMAccountName=user))');
        console.log('      - Missing parenthesis: sAMAccountName=user)');
        console.log('      - Extra characters in .env file');
        console.log('');
        console.log('   Fix in .env:');
        console.log('      LDAP_SEARCH_FILTER=(sAMAccountName={{username}})');
        console.log('');
      }
      
      client.unbind();
      process.exit(1);
    });
    
    res.on('end', () => {
      client.unbind();
      
      if (!found) {
        console.log('   ⚠️  User not found');
        console.log('');
        console.log('   Possible reasons:');
        console.log('      - Username does not exist in AD');
        console.log('      - User is in different OU outside search base');
        console.log('      - Wrong username attribute (should be sAMAccountName)');
        console.log('');
        console.log('   Try with another username:');
        console.log(`      node test-ldap-standalone.js your_username`);
        console.log('');
      } else {
        console.log('');
        console.log('='.repeat(70));
        console.log('✅ LDAP TEST SUCCESSFUL!');
        console.log('='.repeat(70));
        console.log('');
        console.log('Your LDAP configuration is correct.');
        console.log('You can now use AD authentication in the application.');
        console.log('');
      }
      
      process.exit(found ? 0 : 1);
    });
  });
});
