//隔离服务框架和控制器逻辑,比如以后不用express框架了,但是希望逻辑代码依然可以继续使用,
//就需要将框架和逻辑隔离开,这里就是隔离的地方

//resb 代表的数据结构就是通用的{ code:1,data:{},msg:'xxxx'}

const logger = require('./zwlogger');
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

        return param;
    }

    //这个方法,将数据格式化为通用的 结构,,,继承可修改该行为
    //返回 resb ,checkedparam
    async checkParam( param )
    {
        param.resb = ZWBaseCtr.makeResb(null);
        return new Promise( (resolve,reject)=>{ resolve( param ) } )
    }
    //根据path寻找合适的方法,继承可修改该行为
    //路由方法,必须返回 Promise 对象
    //规则,枚举对象里面的 ctr_ 开头的方法,作为响应方法 
    // 比如/user.getinfo 需要寻找 user对象下面 ctr_getinfo的方法
    getRouterFunc( param )
    {
        if( !this instanceof ZWBaseCtr ) return null;

        let funcname =  param.path.split('.');
        if( !funcname || funcname.length != 2 ) return null;
        funcname = funcname[1];
        funcname = 'ctr_' + funcname;
        return this[  funcname ];
    }

    //通用加解密方法,,继承可修改该行为
    //将数据解密出来
    decryptionData( param )
    {
        return param;
    }
    encryptionData( resb )
    {
        return resb;
    }

    //路由响应函数,全部用ctr_开头,全部需要返回  Promise
    async ctr_root( param )
    {
        return new Promise( (resolve,reject) => { resolve( ZWBaseCtr.makeResb('not any one can do this...') )  }  );
    }
}

module.exports = ZWBaseCtr;
