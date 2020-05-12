/**
 * RPC 管理器,可以实现将控制器/控制下面的某个函数 无缝RPC化,不需要修改任何代码
 * 只需要调用注册方法即可.
 */
const   logger      = require('./zwlogger');
const   ZWRPCBridge = require('./zwrpcbridge').ZWRPCBridge;
const   ZWRPCData   = require('./zwrpcbridge').ZWRPCData;

class ZWRPCRegInfo
{
    /**
     * 原方法,
     * @type {Function}
     * @memberof ZWRPCRegInfo
     */
    org_func;

    /**
     * 被hook之后方法
     * @type {Function}
     * @memberof ZWRPCRegInfo
     */
    hook_func;

    /**
     *一个函数的唯一标识ID
     * @type {string}
     * @memberof ZWRPCRegInfo
     */
    func_unique_id;

    /**
     * 方法的名字
     *
     * @memberof ZWRPCRegInfo
     */
    func_name;
}

/**
 *********************** 重要说明 ***********************
 * 一个类的实例的某个方法 想要无缝衔接 RPC化:
 * 该实例 必须实现 rpc_decode,rpc_encode,getRPCMgr,必须返回Promise
 */
/**
 * RPC函数 管理器,用于注册RPC方法,hook函数调用
 * 可以实现 宿主对象的方法及宿主对象的某个变量的某个方法 RPC化
 * @class ZWRPCMgr
 */
class ZWRPCMgr
{
    /**
     *Creates an instance of ZWRPCMgr.
     * @param {*} ctrobj,想要实现RPC的控制器对象
     * @param {ZWRPCBridge} rpcbridge rpc数据通道
     * @memberof ZWRPCMgr
     */
    constructor( ctrobj , rpcbridge )
    {
        this._ctrobj            = ctrobj;
        this._rpcbridge         = rpcbridge;
        this._func_v = ((r)=>{
            this._preOnRPC(r);
        });
        this._rpcbridge.on( ZWRPCBridge.st_event_rpc_on ,this._func_v);
    }
    async _preOnRPC(r)
    {
        //这里预先判断这个控制器是否可以响应
        if( !this._RPCFuncInfo.get( r.func_unique_id ) ) return Promise.resolve(false);
        let resb = await this.onRPC( r );
        return this._rpcbridge.resbDataForCall( resb );
    }
    /**
     * 停止RPC处理,清理资源
     *
     * @memberof ZWRPCMgr
     */
    stop()
    {
        for( let one of this._RPCFuncInfo.values() )
        {
            this.unRegRPC( one.func_name );
            one.org_func = null;
            one.hook_func = null;
        }
        this._RPCFuncInfo.clear();         
        this._rpcbridge.removeListener( ZWRPCBridge.st_event_rpc_on ,this._func_v );
        this._ctrobj = null;
        this._rpcbridge = null;
    }
    /**
     * 响应RPC数据
     * @param {ZWRPCData} rpcdata,收到的数据
     * @returns {Promise<ZWRPCData>} 响应之后返回的数据
     * @memberof ZWRPCMgr
     */
    async onRPC( rpcdata )
    {
        let retrpcdata = rpcdata||{};
        retrpcdata.errmsg = '未知RPC错误';
        retrpcdata.errcode = 1;
        try
        {
            do
            {
                if( !rpcdata )
                {
                    retrpcdata.errmsg = '无效的参数';
                    break;
                } 
                let var_obj = null;
                let reginfo = this._RPCFuncInfo.get( retrpcdata.func_unique_id );
                if( !reginfo )
                {
                    retrpcdata.errmsg   = '未注册的RPC方法';
                    retrpcdata.errcode  = 2;
                    break;
                }

                var_obj = this._ctrobj;
                if( !var_obj )
                {
                    retrpcdata.errmsg = '对方已停止响应RPC';
                    break;
                }

                /**
                 * @type Function
                 */
                let func = reginfo.org_func;
                if( !func || typeof func !== 'function' )
                {
                    retrpcdata.errmsg = '无效的RPC方法';
                    break;
                }

                //尝试解码数据
                /**
                 * @type Function
                 */
                let decode_func = var_obj[ 'rpc_decode' ];
                let encode_func = var_obj[ 'rpc_encode' ];
                if( !decode_func || typeof decode_func !== 'function' ||
                    !encode_func || typeof encode_func !== 'function'
                )
                {
                    retrpcdata.errmsg = '未实现编/解码方法';
                    break;
                }

                //将收到的数据进行解码,然后执行真正的方法
                retrpcdata = decode_func.call(var_obj,retrpcdata);

                let r  = func.apply(var_obj,retrpcdata.param_list);
                if( r && r instanceof Promise ) r = await r;
                retrpcdata.ret_data     = r;
                retrpcdata.param_list   = [];//把参数置空,否则encode_func会对其进行编码,
                retrpcdata              = encode_func.call(var_obj,retrpcdata);//将返回值编码
                retrpcdata.errmsg       = 'RPC调用成功';
                retrpcdata.errcode      = 0;
            }while(0);
        }
        catch(e)
        {
            retrpcdata.errmsg = e.message;
        }
        return Promise.resolve(retrpcdata);
    }
    _getVarName( obj )
    {
        let var_name = null;
        if( obj === this._ctrobj )
        {
            var_name = 'this';
        }
        else
        {
            let ctr_vars = Object.keys(this._ctrobj);
            for( let one of ctr_vars )
            {
                if( this._ctrobj[one] !== obj ) continue;
                var_name = one;
                break;
            }
        }
        return var_name;
    }
    _getVarObj( name )
    {
        if( name === 'this' ) return this._ctrobj;
        return this._ctrobj[ name ];
    }


    /**
     * RPC注册信息,需要RPC支持的方法,注册就行了
     * @type Map<string,ZWRPCRegInfo>
     * @memberof ZWBaseCtr
     */
    _RPCFuncInfo = new Map();

    /**
     * 变量方法 注册RPC响应,
     * 注册之后,该方法执行的时候会被发送远端,该方法也会接收到远端的请求
     * @param {string|Function} funcname
     * @returns {boolean}
     * @memberof ZWBaseCtr
     */
    regRPC( funcname )
    {
        if( !funcname ) return false;
        if( typeof funcname == 'function' ) funcname = funcname.name;
        return this._rpcRU( funcname,1);
    }
    /**
     * 注册RPC方法,只能向外调用出去,无法响应请求
     *
     * @param {*} funcname
     * @memberof ZWRPCMgr
     */
    regRPCForCall( funcname )
    {
        if( !funcname ) return false;
        if( typeof funcname == 'function' ) funcname = funcname.name;
        return this._rpcRU( funcname,2);
    }
    /**
     * 注册RPC方法,只能接受调入的请求,无向外调用出去
     *
     * @param {*} funcname
     * @memberof ZWRPCMgr
     */
    regRPCForResb( funcname )
    {
        if( !funcname ) return false;
        if( typeof funcname == 'function' ) funcname = funcname.name;
        return this._rpcRU( funcname,3);
    }

    /**
     * 变量/对象 删除注册RPC响应
     * @param {string|Function} funcname
     * @returns {boolean}
     * @memberof ZWBaseCtr
     */
    unRegRPC( funcname )
    {
        if( !funcname ) return false;
        if( typeof funcname == 'function' ) funcname = funcname.name;
        return this._rpcRU(funcname,0);
    }

    /**
     * 添加/删除注册RPC响应
     * 
     * @param {string} funcname
     * @param {number} regtype,0:删除,1注册可以请求且响应,2:注册只请求,3:注册只响应
     * @param {number} pid,响应该方法的pid,==1表示本机所有进程都可以响应
     * @returns {boolean};
     * @memberof ZWBaseCtr
     */
    _rpcRU( funcname , regtype )
    {
        //以前的版本是可以RPC到指定的控制器下面的某个变量,
        //这里去掉了这个功能,只能调用到控制器下面的方法
        let var_obj = this._ctrobj;

        let func =  var_obj[ funcname ];
        if( !func || typeof func !== 'function' )
        {//如果根本没有对应方法,直接报错
            return false;
        }

        let var_name = this._getVarName(var_obj);
        if( var_name == null) return false;
        let func_id = this._makeFuncUniqueId( var_name , funcname );
        let t = this._RPCFuncInfo.get( func_id );
        if( regtype )
        {
            //如果已经注册过了
            if( t ) logger.log('recover reg:',func_id);

            //1.看看是否实现了编码/解码方法
            let decode_func = var_obj[ 'rpc_decode' ];
            let encode_func = var_obj[ 'rpc_encode' ];
            if( !decode_func || typeof decode_func !== 'function' ||
                !encode_func || typeof encode_func !== 'function' )
                throw new Error('未实现编/解码方法');
            let getrpcmsg_func = var_obj[ 'getRPCMgr' ];
            if( !getrpcmsg_func || typeof getrpcmsg_func !== 'function' )
                throw new Error('未实获取RPC管理器方法');
            
            //2.hook 方法,实现RPC化
            let reginfo = new ZWRPCRegInfo();
            reginfo.org_func = func;
            reginfo.func_name = funcname;
            //凡是需要调用出去的,都需要hook,如果只是响应不需要hook
            if( regtype == 1 || regtype == 2 )
            {
                reginfo.hook_func = this._makeHookFunc( func ,var_name,funcname);
                reginfo.func_unique_id = func_id;
                if( !reginfo.hook_func ) throw new Error('make rpc hook err');
                var_obj[ funcname ] = reginfo.hook_func;
            }
            this._RPCFuncInfo.set( func_id,reginfo );
            //只要不是仅请求 都向节点管理器表明我可以响应这个方法
            if( regtype != 2 ) this._rpcbridge.iCanResbThisFunc( reginfo.func_unique_id );
        }
        else
        {
            if( !t ) return true;
            //如果是之前被hook的,就还原
            var_obj[ funcname ] = t.org_func;
            this._RPCFuncInfo.delete( func_id );
            //向节点管理表明,我不再响应这个方法了,但是或许还有RPC进入,会自动切换到其他节点,
            this._rpcbridge.iCanNotResbThisFunc( func_id );
        }
        return true;
    }
    /**
     * 生成一个方法的唯一ID,
     * 之前是因为想要直接通过HTTP发送数据,所以在ID里面包含了HTTP响应路径信息
     * 这里重新简化处理,ID就是ID,唯一就行,其他属性通过ID映射
     * @param {*} var_name
     * @param {*} funcname
     * @returns
     * @memberof ZWRPCMgr
     */
    _makeFuncUniqueId( var_name , funcname )
    {
        return this._ctrobj.getFuncUniqueId( funcname );
    }

    /**
     * 获取函数参数定义
     *
     * @param {Function} func
     * @returns {string}
     * @memberof ZWRPCMgr
     */
    getFuncDeclare( func )
    {
        /**
         * @type string
         */
        let str = func.toString();
        let i = str.indexOf('(');
        if( i == -1 ) return null;
        let left = 0;
        let func_declare = null;
        for( let j = i+1; j < str.length; j ++ )
        {
            if( str[j] == '(') 
            {
                left++;
                continue;
            }
            if( str[j] == ')' )
            {
                if( left == 0 )
                {
                    func_declare = str.substring(i,j+1);
                    break;
                }
                else left--;
            }
        }
        return func_declare;
    }

    /**
     * 根据函数申明获取参数名字
     * 比如:"(a,b=1,c=2)" 返回 "a,b,c"
     * @param {string} declare
     * @returns {string} 返回字符串
     * @memberof ZWRPCMgr
     */
    getDeclareArgName( declare )
    {
        //https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Functions/arguments
        //由于严格模式,arguments 无法获取到默认参数之类数据,所以这个方法才是RPC实现里面比较麻烦的地方
        //还有更好的办法吗?


        //整个函数的目的就是取参数的名字
        if( !declare || !declare.length ) return null;
        //去除两端的括号 和 空白字符
        let exp_br = declare.replace(/((^\s*\({1})|(\){1}\s*$))/g,'');
        if( !exp_br.match(/(=|\.{3})/g) )//如果没有 = ,没有 ... 就是默认参数
        {//如果没有默认参数,那就简单了
            return exp_br;
        }
        //暂时不支持有默认参数的情况
        throw new Error('i can not do this.....');

        //如果有默认参数,就太麻烦了,真是太麻烦了
        //默认参数值:数字,对象,字符串,函数,箭头函数,解构赋值,剩余参数

        //( a,b=1,c=',:{=}()',d={'name':'zw'},e=function(x){return x+1;},f=(x)=>{return x+1})
        //( {a:b,c:{d:e}} = { a:'c',b:{c:'d'} } , ... args )

    }
    /**
     * 生成hook函数,截获之前的方法调用
     *
     * @param {Function} orgfunc
     * @returns {Function} 返回新的函数
     * @memberof ZWRPCMgr
     */
    _makeHookFunc( orgfunc ,var_name,funcname )
    {
        let org_func_declare = this.getFuncDeclare( orgfunc );
        if( !org_func_declare || !org_func_declare.length ) return null;
        let arg_names = this.getDeclareArgName( org_func_declare );
        if( !arg_names ) return null;
        
        //hook_body 里面的this就是外面调用者的this,该对象必须要有 getRPCMgr方法,
        let hook_body = "return this.getRPCMgr()._rpc_callout_waper("+arg_names+",'"+var_name+"','"+funcname+"')";//这里调试发现一个现象,funcname 不用 ''框起来,会把函数传递过去,即使没有加this
        let func_str  = 'return function '+funcname+org_func_declare+'{'+hook_body+'}';
        
        return (new Function( func_str ))();
    }
    async _hook_func_body_sample( )
    {//hook方法大概这样...
        return this.getRPCMgr()._rpc_callout_waper(a,b,c,d,e,var_name,funcname);
    }

    /**
     * RPC调用包装,后2个参数是变量名和函数名,后面就是真正的参数了
     * @memberof ZWRPCMgr
     */
    async _rpc_callout_waper()
    {
        try
        {
            /**
            * @type ZWRPCData
            */
            let rpcdata                 = new ZWRPCData();

            //通过getRPCMgr调用的,所以这里的this已经是 rpcmgr了
            let var_name     = arguments[arguments.length-2];
            let func_name    = arguments[arguments.length-1];
            for(let i = 0 ; i < arguments.length-2; i++ )
            {
                rpcdata.param_list.push( arguments[i] );
            }
            rpcdata.func_unique_id = this._makeFuncUniqueId(var_name,func_name);
            let var_obj = this._getVarObj(var_name);
            rpcdata = await this._rpcbridge.sendDataToWhoCanResb( var_obj.rpc_encode( rpcdata ) );
            if( rpcdata.errcode == 0 )
            {
                return Promise.resolve( var_obj.rpc_decode( rpcdata ).ret_data );
            }
            return Promise.reject( new Error(rpcdata.errmsg) );
        }
        catch(e)
        {
            throw e;
        }
    }


    /** 
     * 想要自动RPC化,在需要的对象里面实现下面3个方法,然后注册就行了
     * 如果没有特别的数据需要处理,能够自动转为JSON的,,那么可以什么都不做
     * 
    */

    /**
     * 编码RPC数据,主要就是把 param_list ,ret_data 编码
     *
     * @param {ZWRPCData} rpcdata
     * @returns {ZWRPCData} 
     * @memberof ZWBaseCtr
     */
    rpc_encode( rpcdata )
    {
        return rpcdata;
    }

    /**
     * 解码RPC数据,主要就是把 ret_data,ret_data 解码
     *
     * @param {ZWRPCData} rpcdata
     * @returns {ZWRPCData} 
     * @memberof ZWBaseCtr
     */
    rpc_decode( rpcdata )
    {
        return rpcdata;
    }
    /**
     * 返回RPC管理器
     * @returns {ZWRPCMgr}
     * @memberof ZWRPCMgr
     */
    getRPCMgr()
    {
        return null;
    }
}

module.exports.ZWRPCMgr     = ZWRPCMgr;