const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8000;

// Validate environment variables
const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE', 'DB_PORT'];
requiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
        console.error(`Error: Environment variable ${varName} is not set.`);
        process.exit(1);
    }
});

// Database connection
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT,
});

// Middleware
app.use(express.json());
app.use(cors({
    origin: '*' // for development, specify origins or use '*' for all
}));
app.use(morgan('dev'));

app.get('/api/orders', async (req, res) => {
    try {
        const query = `
            SELECT 
                o.orderid, 
                o.userid AS client_id,
                o.totalprice, 
                o.orderdate, 
                o.status, 
                o.ref, 
                c.full_name, 
                c.address
            FROM 
                public.orders o
            JOIN 
                public.users u ON o.userid = u.userid
            JOIN 
                public.client_details c ON u.userid = c.user_id
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Delivery personnel endpoint
app.get('/api/delivery-men', async (req, res) => {
    try {
        const query = 'SELECT * FROM public.delivery_person';
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching delivery men:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});app.post('/api/create-personnel', async (req, res) => {
  const {
    date_started,
    name,
    address,
    age,
    contact_number,
    license_number,
    car_plate_assigned,
    username,
    password
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert into users table
    const hashedPassword = await bcrypt.hash(password, 10);
    const insertUserQuery = `
      INSERT INTO public.users (username, password)
      VALUES ($1, $2)
      RETURNING userid;
    `;
    const userResult = await client.query(insertUserQuery, [username, hashedPassword]);
    const userId = userResult.rows[0].userid;

    // Insert into delivery_person table
    const insertDeliveryPersonQuery = `
      INSERT INTO public.delivery_person (user_id, date_started, name, address, age, contact_number, license_number, car_plate_assigned, order_count_today)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id;
    `;
    const deliveryPersonValues = [userId, date_started, name, address, age, contact_number, license_number, car_plate_assigned, 0];
    const deliveryPersonResult = await client.query(insertDeliveryPersonQuery, deliveryPersonValues);

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Delivery personnel created successfully',
      userId: userId,
      deliveryPersonId: deliveryPersonResult.rows[0].id
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating personnel:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

// Endpoint to assign a delivery
app.post('/api/assign-delivery', async (req, res) => {
    const { order_id, delivery_person_id, client_id } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        
        const insertDeliveryQuery = `
            INSERT INTO public.deliveries (order_id, delivery_person_id, client_id, status)
            VALUES ($1, $2, $3, 'Assigned') RETURNING *;
        `;
        const insertDeliveryValues = [order_id, delivery_person_id, client_id];
        const insertDeliveryResult = await client.query(insertDeliveryQuery, insertDeliveryValues);

        const updateOrderStatusQuery = `
            UPDATE public.orders
            SET status = 'On Way'
            WHERE orderid = $1;
        `;
        const updateOrderStatusValues = [order_id];
        await client.query(updateOrderStatusQuery, updateOrderStatusValues);

        const incrementOrderCountQuery = `
            UPDATE public.delivery_person
            SET order_count_today = order_count_today + 1
            WHERE id = $1;
        `;
        const incrementOrderCountValues = [delivery_person_id];
        await client.query(incrementOrderCountQuery, incrementOrderCountValues);

        await client.query('COMMIT');
        res.status(201).json(insertDeliveryResult.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error assigning delivery:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        client.release();
    }
});

// Other endpoints...

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
});

// Graceful shutdown
const shutdown = () => {
    pool.end(() => {
        console.log('Closed database connection pool.');
        process.exit(0);
    });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Server startup
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
