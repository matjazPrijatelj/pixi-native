const Path = require('path')

const getBindingPath = () => Path.join(__dirname, 'dist', `${process.platform}-${process.arch}`, 'native_window.node')

module.exports = { getBindingPath }
