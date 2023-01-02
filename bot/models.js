const sequelize = require('./db');
const {DataTypes} = require('sequelize');

const Products = sequelize.define('products', {
    id: {type: DataTypes.INTEGER, primaryKey: true, unique: true, autoIncrement: true},
    product: {type: DataTypes.STRING},
})

module.exports = Products;