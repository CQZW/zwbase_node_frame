const log4js              =   require('log4js');
const OS                =   require('os');

const logcfg = {
    
    //关于启动方式的日志问题,
    pm2: true,        
    disableClustering: true,
    appenders: {
        console:{type: 'console' },
        logfile: 
        {
            type: 'dateFile', 
            filename: './logs/log.log',
            maxLogSize : 1024*1024*10,
            pattern: 'MM-dd',
            alwaysIncludePattern:true
        },
        httpfile: 
        {
            type: 'dateFile', 
            filename: './logs/http.log',
            maxLogSize : 1024*1024*10,
            pattern: 'MM-dd',
            alwaysIncludePattern:true
        },
    },
    categories:{
        default: { appenders: ['httpfile'], level: 'all' },
        log: { appenders: ['logfile'], level: 'all' },
        http: { appenders: ['httpfile'], level: 'all' },
        console: { appenders: ['console'], level: 'all' }
    }
}

class ZWLogger
{
    static cfgFor4JS( cfg )
    {
        log4js.configure( logcfg );
    }
    static connectLogger( logname ='http', opt = {level: log4js.levels.ALL} )
    {
        return log4js.connectLogger( log4js.getLogger (logname) ,opt );
    }

    //本地调试环境就输出到控制台吧
    static isConsole = function(){
        return OS.platform() == 'darwin';
    }
    static connectLogger = function( logname ='http', opt = {level: log4js.levels.ALL} )
    {
        return log4js.connectLogger( log4js.getLogger (logname) ,opt );
    }
    static _getLoggerInstance = function( logname = 'http' )
    {
        return log4js.getLogger( logname );
    }
    static log = function(message, ...args)
    {
        ZWLogger._getLoggerInstance(  ZWLogger.isConsole()?'console': 'log' ).info(message,args);
    }
    static error = function(message, ...args)
    {
        ZWLogger._getLoggerInstance( ZWLogger.isConsole()?'console':'log' ).error(message,args);
    }
}

ZWLogger.cfgFor4JS( logcfg );

module.exports = ZWLogger;