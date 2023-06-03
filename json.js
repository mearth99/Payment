const fs = require('fs');

const jsonFile = fs.readFileSync('./DB.json', 'utf8');
const jsonData = JSON.parse(jsonFile);

console.log(jsonData.User[28]);