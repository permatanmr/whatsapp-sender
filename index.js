const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const csv = require('csv-parser');

class WhatsAppBulkSender {
    constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: false,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });
        
        this.contacts = [];
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        // Generate QR code for authentication
        this.client.on('qr', (qr) => {
            console.log('QR Code received. Please scan with your WhatsApp mobile app:');
            qrcode.generate(qr, { small: true });
        });

        // Client ready
        this.client.on('ready', () => {
            console.log('WhatsApp client is ready!');
        });

        // Authentication successful
        this.client.on('authenticated', () => {
            console.log('Authentication successful!');
        });

        // Authentication failure
        this.client.on('auth_failure', (msg) => {
            console.error('Authentication failed:', msg);
        });

        // Client disconnected
        this.client.on('disconnected', (reason) => {
            console.log('Client was logged out:', reason);
        });
    }

    // Read contacts from CSV file
    async readContactsFromCSV(filePath) {
        return new Promise((resolve, reject) => {
            const contacts = [];
            
            if (!fs.existsSync(filePath)) {
                reject(new Error(`CSV file not found: ${filePath}`));
                return;
            }

            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (row) => {
                    // Expected CSV format: name, phone, message (optional)
                    if (row.phone) {
                        contacts.push({
                            name: row.name || 'Unknown',
                            phone: this.formatPhoneNumber(row.phone),
                            message: row.message || null
                        });
                    }
                })
                .on('end', () => {
                    console.log(`Loaded ${contacts.length} contacts from CSV`);
                    resolve(contacts);
                })
                .on('error', (error) => {
                    reject(error);
                });
        });
    }

    // Format phone number to WhatsApp format
    formatPhoneNumber(phone) {
        // Remove all non-digit characters
        let cleaned = phone.replace(/\D/g, '');
        
        // Add country code if not present (assuming Indonesia +62)
        // Modify this based on your country
        if (!cleaned.startsWith('62') && cleaned.startsWith('0')) {
            cleaned = '62' + cleaned.substring(1);
        } else if (!cleaned.startsWith('62') && !cleaned.startsWith('0')) {
            cleaned = '62' + cleaned;
        }
        
        return cleaned + '@c.us';
    }

    // Send message to a single contact
    async sendMessage(contact, defaultMessage = '') {
        try {
            const message = contact.message || defaultMessage;
            if (!message) {
                console.log(`No message provided for ${contact.name} (${contact.phone})`);
                return false;
            }

            // Personalize message with contact name
            const personalizedMessage = message.replace('{name}', contact.name);
            
            // Check if number exists on WhatsApp
            const numberId = await this.client.getNumberId(contact.phone);
            if (!numberId) {
                console.log(`❌ ${contact.name} (${contact.phone}) is not registered on WhatsApp`);
                return false;
            }

            // Send message
            await this.client.sendMessage(contact.phone, personalizedMessage);
            console.log(`✅ Message sent to ${contact.name} (${contact.phone})`);
            return true;

        } catch (error) {
            console.error(`❌ Failed to send message to ${contact.name} (${contact.phone}):`, error.message);
            return false;
        }
    }

    // Send messages to all contacts
    async sendBulkMessages(csvFilePath, defaultMessage = '', delay = 2000) {
        try {
            // Start the client
            await this.client.initialize();

            // Wait for client to be ready
            await new Promise((resolve) => {
                if (this.client.info) {
                    resolve();
                } else {
                    this.client.once('ready', resolve);
                }
            });

            // Read contacts from CSV
            this.contacts = await this.readContactsFromCSV(csvFilePath);

            if (this.contacts.length === 0) {
                console.log('No contacts found in CSV file');
                return;
            }

            console.log(`\nStarting to send messages to ${this.contacts.length} contacts...`);
            console.log(`Delay between messages: ${delay}ms\n`);

            let successCount = 0;
            let failureCount = 0;

            // Send messages with delay
            for (let i = 0; i < this.contacts.length; i++) {
                const contact = this.contacts[i];
                console.log(`[${i + 1}/${this.contacts.length}] Processing ${contact.name}...`);

                const success = await this.sendMessage(contact, defaultMessage);
                if (success) {
                    successCount++;
                } else {
                    failureCount++;
                }

                // Add delay between messages to avoid being blocked
                if (i < this.contacts.length - 1) {
                    console.log(`Waiting ${delay}ms before next message...\n`);
                    await this.sleep(delay);
                }
            }

            console.log('\n=== SUMMARY ===');
            console.log(`Total contacts: ${this.contacts.length}`);
            console.log(`Messages sent successfully: ${successCount}`);
            console.log(`Failed messages: ${failureCount}`);

        } catch (error) {
            console.error('Error in bulk message sending:', error);
        }
    }

    // Utility function to add delay
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Graceful shutdown
    async disconnect() {
        await this.client.destroy();
        console.log('WhatsApp client disconnected');
    }
}

// Usage example
async function main() {
    const sender = new WhatsAppBulkSender();
    
    // Configuration
    const csvFilePath = 'contacts.csv'; // Path to your CSV file
    const defaultMessage = `Hello {name}! 
    
This is a test message sent via WhatsApp automation.
Thank you!`;
    const delayBetweenMessages = 3000; // 3 seconds delay

    try {
        await sender.sendBulkMessages(csvFilePath, defaultMessage, delayBetweenMessages);
    } catch (error) {
        console.error('Application error:', error);
    } finally {
        // Cleanup
        process.on('SIGINT', async () => {
            console.log('\nReceived SIGINT. Cleaning up...');
            await sender.disconnect();
            process.exit(0);
        });
    }
}

// Run the application
if (require.main === module) {
    main();
}


// --- Express API for sending WhatsApp messages ---
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

let senderInstance;

// Initialize WhatsApp client once
async function initWhatsAppClient() {
    if (!senderInstance) {
        senderInstance = new WhatsAppBulkSender();
        await senderInstance.client.initialize();
        await new Promise((resolve) => {
            if (senderInstance.client.info) {
                resolve();
            } else {
                senderInstance.client.once('ready', resolve);
            }
        });
    }
}

// API endpoint to send a message
app.post('/send-message', async (req, res) => {
    const { name, phone, message } = req.body;
    if (!phone || !message) {
        return res.status(400).json({ error: 'phone and message are required' });
    }
    try {
        await initWhatsAppClient();
        const contact = {
            name: name || 'Unknown',
            phone: senderInstance.formatPhoneNumber(phone),
            message: message
        };
        const success = await senderInstance.sendMessage(contact);
        if (success) {
            res.json({ status: 'success', detail: `Message sent to ${contact.name}` });
        } else {
            res.status(500).json({ status: 'failed', detail: `Failed to send message to ${contact.name}` });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start the API server if run directly
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`API server listening on port ${PORT}`);
    });
}

module.exports = WhatsAppBulkSender;