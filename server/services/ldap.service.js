// server/services/ldap.service.js - ROBUST VERSION
import ldap from 'ldapjs';

class LDAPService {
  constructor() {
    this.enabled = process.env.LDAP_ENABLED === 'true';
    this.ldapUrl = process.env.LDAP_URL;
    this.bindDN = process.env.LDAP_BIND_DN;
    this.bindPassword = process.env.LDAP_BIND_PASSWORD;
    this.searchBase = process.env.LDAP_SEARCH_BASE;
    this.searchFilter = process.env.LDAP_SEARCH_FILTER || '(sAMAccountName={{username}})';
    
    // Attributes Mapping
    this.usernameAttribute = process.env.LDAP_USERNAME_ATTRIBUTE || 'sAMAccountName';
    this.mailAttribute = process.env.LDAP_MAIL_ATTRIBUTE || 'mail';
    this.displayNameAttribute = process.env.LDAP_DISPLAYNAME_ATTRIBUTE || 'cn';
    this.firstNameAttribute = process.env.LDAP_FIRSTNAME_ATTRIBUTE || 'givenName';
    this.lastNameAttribute = process.env.LDAP_LASTNAME_ATTRIBUTE || 'sn';

    // Settings
    this.connectionTimeout = parseInt(process.env.LDAP_CONNECTION_TIMEOUT) || 10000;
    this.searchTimeout = parseInt(process.env.LDAP_SEARCH_TIMEOUT) || 5000;
    
    // Admin Groups (Array)
    this.adminGroups = (process.env.LDAP_ADMIN_GROUPS || '')
      .split(',')
      .map(g => g.trim().toLowerCase())
      .filter(Boolean);
  }

  isEnabled() {
    return this.enabled && this.ldapUrl && this.bindDN && this.searchBase;
  }

  createClient() {
    return ldap.createClient({
      url: this.ldapUrl,
      timeout: this.searchTimeout,
      connectTimeout: this.connectionTimeout,
      tlsOptions: {
        rejectUnauthorized: process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== 'false'
      },
      reconnect: true
    });
  }

  escapeLDAPValue(value) {
    if (!value) return '';
    return String(value)
      .replace(/\\/g, '\\5c')
      .replace(/\*/g, '\\2a')
      .replace(/\(/g, '\\28')
      .replace(/\)/g, '\\29')
      .replace(/\0/g, '\\00')
      .replace(/\//g, '\\2f');
  }

  buildSearchFilter(username) {
    const escapedUsername = this.escapeLDAPValue(username);
    return this.searchFilter.replace('{{username}}', escapedUsername);
  }

  async searchUser(username) {
    return new Promise((resolve, reject) => {
      const client = this.createClient();
      const filter = this.buildSearchFilter(username);
      
      console.log(`🔍 LDAP Search: ${username} in ${this.searchBase}`);

      // Timeout Safety
      const timeout = setTimeout(() => {
        client.unbind();
        reject(new Error('LDAP Search Timeout'));
      }, this.searchTimeout);

      client.bind(this.bindDN, this.bindPassword, (err) => {
        if (err) {
          clearTimeout(timeout);
          client.unbind();
          console.error('❌ LDAP Bind Failed:', err.message);
          return reject(err);
        }

        const opts = {
          filter: filter,
          scope: 'sub',
          attributes: ['dn', 'cn', 'sn', 'givenName', 'mail', 'memberOf', 'title', 'department', 'sAMAccountName', 'userPrincipalName', 'displayName']
        };

        const users = [];

        client.search(this.searchBase, opts, (err, res) => {
          if (err) {
            clearTimeout(timeout);
            client.unbind();
            return reject(err);
          }

        res.on('searchEntry', (entry) => {
            // ✅ ROBUST PARSING: Jika entry.object kosong, ambil dari attributes array
            let userObj = entry.object;
            
            if (!userObj || Object.keys(userObj).length <= 1) {
                userObj = { dn: entry.objectName.toString() };
                if (entry.attributes) {
                    entry.attributes.forEach(attr => {
                        // ✅ FIX: Ganti .vals menjadi .values (sesuai warning)
                        // Cek .values dulu, jika tidak ada baru fallback ke .vals (untuk jaga-jaga)
                        const values = attr.values || attr.vals;
                        
                        userObj[attr.type] = values && values.length > 0 ? values[0] : null;
                        
                        // Khusus memberOf kita butuh array full
                        if (attr.type === 'memberOf') {
                            userObj['memberOf'] = values;
                        }
                    });
                }
            }
            
            console.log(`✅ User found: ${userObj.sAMAccountName || userObj.cn || 'Unknown'}`);
            users.push(userObj);
          });
          res.on('error', (err) => {
            console.error('❌ Search Stream Error:', err.message);
          });

          res.on('end', (result) => {
            clearTimeout(timeout);
            client.unbind();
            
            if (users.length > 0) {
              resolve(users[0]);
            } else {
              console.log('⚠️  User not found (No results)');
              resolve(null);
            }
          });
        });
      });
    });
  }

  async authenticate(username, password) {
    try {
      if (!this.isEnabled()) return { success: false, message: 'LDAP Disabled' };

      // 1. Cari User
      const userEntry = await this.searchUser(username);
      if (!userEntry) return { success: false, message: 'User not found' };

      const userDN = userEntry.dn || userEntry.distinguishedName;
      if (!userDN) return { success: false, message: 'Invalid User DN' };

      // 2. Cek Password (Bind sebagai User)
      const valid = await this.bindUser(userDN, password);
      if (!valid) return { success: false, message: 'Invalid Credentials' };

      // 3. Format Data User
      const groups = this.extractGroups(userEntry.memberOf);
      
      // Ambil atribut sesuai mapping environment
      const userInfo = {
        username: userEntry[this.usernameAttribute] || username,
        email: userEntry[this.mailAttribute],
        displayName: userEntry[this.displayNameAttribute] || userEntry.cn || username,
        firstName: userEntry[this.firstNameAttribute],
        lastName: userEntry[this.lastNameAttribute],
        department: userEntry.department,
        groups: groups,
        dn: userDN
      };

      return { success: true, user: userInfo };

    } catch (error) {
      console.error('LDAP Auth Error:', error);
      return { success: false, message: error.message };
    }
  }

  async bindUser(dn, password) {
    return new Promise((resolve) => {
      const client = this.createClient();
      client.bind(dn, password, (err) => {
        client.unbind();
        if (err) {
          console.error(`❌ User Bind Failed (${dn}):`, err.message);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  extractGroups(memberOf) {
    if (!memberOf) return [];
    const groups = Array.isArray(memberOf) ? memberOf : [memberOf];
    return groups.map(g => {
      // Parse "CN=Group Name,OU=..." -> "Group Name"
      const match = g.match(/CN=([^,]+)/i);
      return match ? match[1] : g;
    });
  }

  isAdmin(userGroups) {
    if (!userGroups || userGroups.length === 0) return false;
    // Cek apakah user punya salah satu grup admin
    return userGroups.some(g => 
      this.adminGroups.includes(g.toLowerCase())
    );
  }

  async testConnection() {
    try {
        const client = this.createClient();
        return new Promise((resolve) => {
            client.bind(this.bindDN, this.bindPassword, (err) => {
                client.unbind();
                if (err) resolve({ success: false, message: err.message });
                else resolve({ success: true, message: 'Connection OK' });
            });
        });
    } catch (e) {
        return { success: false, message: e.message };
    }
  }
}

export default LDAPService;
