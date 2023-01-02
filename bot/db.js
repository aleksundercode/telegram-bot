const {Sequelize} = require('sequelize');

const sequelize = new Sequelize("postgres://user:pass@postgres:5432/codes");
module.exports = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
     {
         host: process.env.DB_HOST,
         port: process.env.DB_PORT,
         dialect: 'postgres'
     });