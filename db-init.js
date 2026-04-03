const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
    user: 'your_username',
    host: 'localhost',
    database: 'your_database',
    password: 'your_password',
    port: 5432,
});

const initDB = async () => {
    try {
        await client.connect();

        // Read the schema and data from data.json
        const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));

        // Assuming data.json contains the schema and data to be inserted
        for (const [table, rows] of Object.entries(data)) {
            // Create table if not exists
            await client.query(`CREATE TABLE IF NOT EXISTS ${table} (...);`); // Add proper columns here
            for (const row of rows) {
                const columns = Object.keys(row).join(', ');
                const values = Object.values(row).map(value => `'${value}'`).join(', ');
                await client.query(`INSERT INTO ${table} (${columns}) VALUES (${values}) ON CONFLICT (id) DO NOTHING;`);
            }
        }
    } catch (error) {
        console.error('Error initializing database:', error);
    } finally {
        await client.end();
    }
};

initDB();