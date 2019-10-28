const   express     = require('express');
const   logger      = require('./zwlogger')

const   https       = require('https');
const   http        = require('http');

class ZWBaseSrv
{
    constructor()
    {
        //是否启用https
        this.needhttps      = true;
        this.httpsapp       = express();
        this.httpapp        = express();
        this._DBObj         = null;//持有的数据库对象
        logger.cfgFor4JS();
    }
    getDB()
    {
        return this._DBObj;
    }
    getApp()
    {
        if( this.needhttps ) return this.httpsapp;
        return this.httpapp;
    }
    cfgExpress()
    {
        //支持的content-type...
        // parse application/x-www-form-urlencoded
        this.getApp().use(express.urlencoded({limit:5242880, extended: false }));
        // parse application/json
        this.getApp().use(express.json({limit:5242880}));

        //处理xml 如果要处理 微信支付回调 需要这个
        this.getApp().use(express.raw({limit:5242880,type:'text/xml'}));

        this.getApp().use(logger.connectLogger());

        //公开文件,资源文件等等
        this.getApp().use('/',express.static('public',
        {
            cacheControl:true,
            maxAge:(1000*3600*24)
        }));
        
    }
    cfgRouter()
    {//express是按顺序使用路由的,最后都会到这里,继承必须调用super,到这里
        //关于路由,见这里说明
        //http://www.expressjs.com.cn/4x/api.html#router
        //比如这种...
        //app.use( '/api/v1' ,routerapiv1 );
        //app.use( '/api/v2' ,routerapiv2 );

        //如果路由 走到这里,说明之前设置的路由全部都没有接住,,那么最后这3个处理下了,否则就失败了
        this.getApp().all('/',this.r_root);
        this.getApp().all('*',this.r_404);
        this.getApp().use(this.r_500);

    }
    createHttp()
    {
        http.createServer(this.httpapp).listen(80);
        if( this.needhttps )
        {
            //默认情况把所有http的流量都转到 https,自己实习一个跳转方法
            httpapp.all('*',(req,res,next) => {
                this.r_http_redirect(req,res,next);
            });

            https.createServer(this.getHttpsOptions(), this.httpsapp).listen(443);
        }
        logger.log('start http srv ok');
    }
    //https的创建需要证书,自己继承实现
    getHttpsOptions()
    {
        logger.error('get your key cfg for https');
        /*
        let options = {};
        options.key = fs.readFileSync( './xxx.com.key' );
        options.cert = fs.readFileSync( './xxx.com.cer' );
        options.ca = fs.readFileSync( './xxxx.com_ca.crt' );
        return options;
        */
        return null;
    }
    //开始启动...
    async start()
    {
        this._DBObj = await this.startDB();
        return new Promise( (resolve,reject) => {
        
            this.cfgExpress();

            this.cfgRouter();

            this.createHttp();

            resolve( this );
        });

    }
    async startDB()
    {
        logger.error('start your db at you subclass');
        throw new Error('please start db frist');
    }
    //继承并且修改下面方法的行为
    r_root(req,res,next)
    {
        res.send('Hello...');
    }
    r_404( req,res,next)
    {
        logger.log( 'not find any router' );
        res.status(404).send('srv has error');
    }
    r_500(err,req,res,next)
    {
        logger.log( 'srv has error:' ,err);
        res.status(500).send('srv has error');
    }
    r_http_redirect(req,res,next)
    {
        logger.log('cfg your http redir');
        res.redirect( 'https://www.baidu.com' );
    }
}

module.exports = ZWBaseSrv;