const log4js    =   require('log4js');
const OS        =   require('os');

const logcfg = {
    
    //关于启动方式的日志问题,
    pm2: true,        
    pm2InstanceVar:'INSTANCE_ID',
    disableClustering:true,
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
    static cfgFor4JS( cfg = null )
    {
        if( cfg )
            log4js.configure( cfg );
        else
            log4js.configure( logcfg );
    }
    static connectLogger( logname ='http', opt = {level: log4js.levels.ALL} )
    {
        return log4js.connectLogger( log4js.getLogger (logname) ,opt );
    }

    //本地调试环境就输出到控制台吧
    static isConsole(){
        return OS.platform() == 'darwin' || OS.platform() == 'win32';
    }
    static connectLogger ( logname ='http', opt = {level: log4js.levels.ALL} )
    {
        return log4js.connectLogger( log4js.getLogger (logname) ,opt );
    }
    static _getLoggerInstance ( logname = 'http' )
    {
        return log4js.getLogger( logname );
    }
    static log (message, ...args)
    {
        ZWLogger._getLoggerInstance(  ZWLogger.isConsole()?'console': 'log' ).info(message,args);
    }
    static error(message, ...args)
    {
        ZWLogger._getLoggerInstance( ZWLogger.isConsole()?'console':'log' ).error(message,args);
    }
}

module.exports = ZWLogger;