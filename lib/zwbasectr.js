//隔离服务框架和控制器逻辑,比如以后不用express框架了,但是希望逻辑代码依然可以继续使用,
//就需要将框架和逻辑隔离开,这里就是隔离的地方

//resb 代表的数据结构就是通用的{ code:1,data:{},msg:'xxxx'}

const logger = require('./zwlogger');
const crypto = require('crypto');

class ZWBaseCtr
{
    static makeResb(err,obj = {},msg = "操作成功" )
    {
        let ret = {};
        ret.code = err == null?0:1;
        ret.msg = err != null ?( (typeof err == 'string' )?err : err.message):msg;
        ret.data = obj;
        return ret;
    }
    constructor( DBObj ) {
        
        this._DBObj = DBObj;
        this.ctrConfig()
    }
    ctrConfig()
    {
        //加密方式,0 不加密,1 aes-128-cbc 位加密方式
        this.encryType = 0;
        this.clientTypes = [ 'ios','android','mac','win','wx_xcx' ];

    }
    getDBObj()
    {
        return this._DBObj;
    }
    //框架相关的就是 doRouter和 getReqParams
    
    //处理路由,找到对应的 方法,然后分解数据,在这里将框架和逻辑分开.
    doRouter( req , res , next )
    {
        //检查参数,然后执行方法,返回
        let param = this.getReqParams( req );//1.
        this.checkParam( param ).then( ( checkedparam ) =>{//2.
            
            if( checkedparam.resb.code == 0 )
            {
                //寻找对应的逻辑方法,处理,,
                let func = this.getRouterFunc( checkedparam );//3.
                if( func && typeof func == 'function' )
                {
                    return func( this.decryptionData( checkedparam ) );//4.
                }
                else
                {
                    if( func == null )
                    {//如果没有找到入口就到root去响应
                        return this.ctr_root( this.decryptionData( checkedparam ) );//5.
                    }
                    logger.error('not find any path in router');
                    throw new Error('not find router');
                }
            }
            else
            {
                return new Promise( (resolve,reject)=>{ resolve( checkedparam.resb )  } )
            }
        }).then( ( resb ) =>{
            //逻辑处理完成之后,加密然后返回给框架
            let dealedresb = this.encryptionData( resb );//6.
            res.send( JSON.stringify( dealedresb )  );//7.
        })
        .catch( (err) =>{ next(err)} );
    }

    //处理express框架来的数据,
    getReqParams( req )
    {
        let param = null;
        if (req.method == "POST") {
            param = req.body;
        }
        else if(req.method == "GET" ) {
            param = req.query || req.params;
        }else return {};

        param = param || {};
        param.path      = req.path;
/*
        token:'xxxxx',
        userid:1,
        client:'ios/android/mac/win',
        lang:'zh',
        version:'1.0',
        deviceid:'ddddd',*/
    
        //如果还需要请求的其他参数,比如什么iP,agent,,继承修改
        return param;
    }


    async makeToken( param )
    {
        let str = '';
        str += param.userid + '_';
        str += param.deviceid + '_';
        str += param.client + '_';
        str += param.version;
        let md5         = crypto.createHash("md5");
        md5.update(str);
        return md5.digest('hex').toLowerCase();
    }
    

    //是否需要忽略检查token合法性,有些请求需要暂时避开检查,比如,初始化,登录等,
    //通常是1,2个请求需要避开
    isIgnoreCheckToken( path )
    {
        return true;//默认所有都不检查,,子类自己判断
    }

    //这个方法,将数据格式化为通用的 结构,,,继承可修改该行为
    //返回 resb ,checkedparam
    async checkParam( param )
    {
        let ret = ZWBaseCtr.makeResb(null);
        try
        {
            do
            {
                if( !param )
                {
                    ret.msg  = "无效的参数!";
                    ret.code = 9998;
                    break;
                }
                if( this.clientTypes.indexOf( param.client ) == -1 )
                {
                    ret.msg = '无效的访问来源';
                    ret.code = 9998;
                }
                if( !this.isIgnoreCheckToken( param.path ) )
                {
                    let t_token = this.makeToken( param );
                    if( t_token !== param.token )
                    {
                        ret.code = 9999;
                        ret.msg  = '无效的token,请重新登录';
                        break;
                    }
                }
                //更多参数检查,,继承修改行为,比如去数据库查询userid,之类的,
                


            }while(0);
        }
        catch(error)
        {
            logger.error( 'check param has error:',error );
        }
        param.resb = ret;
        return new Promise( (resolve,reject)=>{ resolve( param ) } );
    }

    getFuncNameWithPath( path )
    {
        let funcname =  path.split('.');
        if( !funcname || funcname.length != 2 ) return null;
        funcname = funcname[1];
        return funcname;
    }

    //根据path寻找合适的方法,继承可修改该行为
    //路由方法,必须返回 Promise 对象
    //规则,枚举对象里面的 ctr_ 开头的方法,作为响应方法 
    // 比如/user.getinfo 需要寻找 user对象下面 ctr_getinfo的方法
    getRouterFunc( param )
    {
        if( !this instanceof ZWBaseCtr ) return null;
        let funcname = 'ctr_' + this.getFuncNameWithPath( param.path );
        return this[  funcname ];
    }

    //通用加解密方法,,继承可修改该行为
    //将数据解密出来
    decryptionData( param )
    {
        if( this.encryType == 0  ) return param;
        if( this.encryType == 1 )
        {
            //将 resb.data 字段进行解密,
            let desdata = '';
            let srcdata = param.data;
            if( !srcdata || typeof srcdata != 'string' || !srcdata.length )
            {
                param.data = {};
                return param;
            }
            srcdata = new Buffer( srcdata,'base64' );
            let t = this.getKeyAndIvForDec( param );
            const decipher = crypto.createDecipheriv( 'aes-128-cbc', t[0], t[1] );
            desdata += decipher.update( srcdata ,'base64','utf8');
            desdata += decipher.final('utf8');
            param.data = JSON.parse( desdata );
            return param;
        }
        return param;
    }
    encryptionData( resb )
    {
        if( this.encryType == 0  ) return resb;
        if( this.encryType == 1 )
        {
            //将 resb.data 字段进行加密,
            let desdata = '';
            let srcdata = resb.data;
            if( !srcdata || resb.code )
            {
                resb.data = "";
                return resb;
            }
            srcdata = JSON.stringify( srcdata );
            let t = this.getKeyAndIvForEnc( resb );
            const cipher = crypto.createCipheriv( 'aes-128-cbc', t[0], t[1] );
            desdata += cipher.update( srcdata ,'utf8','base64');
            desdata += cipher.final('base64');
            resb.data = desdata;
            return resb;
        }
        return resb;
    }
    getKeyAndIvForEnc( resb )
    {
        // ase-128-cbc 加密算法要求key和iv长度都为16
        logger.error('your must change key and iv in your prj');
        let _key    = "837fe8729c1ba792";
        let _iv     = "6aece0773ffea97b";
        return [_key,_iv];
    }
    getKeyAndIvForDec( param )
    {
        logger.error('your must change key and iv in your prj');
        return this.getKeyAndIvForDec();
    }

    //路由响应函数,全部用ctr_开头,全部需要返回  Promise
    async ctr_root( param )
    {
        return new Promise( (resolve,reject) => { resolve( ZWBaseCtr.makeResb('not any one can do this...') )  }  );
    }

}

module.exports = ZWBaseCtr;
