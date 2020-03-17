/**
 * RPC 管理器,可以实现将控制器/控制下面的某个对象 的某个函数 无缝RPC化,不需要修改任何代码
 * 
 * 只需要调用注册方法即可.
 */
const   ZWPeerMgr   = require('./zwpeermgr').ZWPeerMgr;
const fetch         = require('node-fetch');

/**
 * RPC 调用协议数据
 * @class ZWRPCData
 */
class ZWRPCData
{
    rpc_version         = '1.0';

    /**
     * 一次调用的ID,标记一次调用
     *
     * @memberof ZWRPCData
     */
    call_id             = 0;

    /**
     * 一个方法的唯一ID
     *
     * @memberof ZWRPCData
     */
    func_unique_id      = '';
    
    param_list          = [];

    ret_data            = null;

    errmsg              = null;

    errcode             = 0;
}
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
     *
     * @memberof ZWRPCRegInfo
     */
    func_unique_id;

}

/**
 *********************** 重要说明 ***********************
 * 一个类的实例的某个方法 想要无缝衔接 RPC化:
 * 1.该实例 必须实现 rpc_decode,rpc_encode,getRPCMgr 3个方法,见最底部
 * 2.要RPC化的方法必须是异步 async,返回值为Promise的
 * 3.如果是多进程服务,这了基于同一机器所有服务RPC方法一致,也就是说这里的RPC 精确到机器级别
 * 无法将某个RPC请求投递到某个进程,只能投递到一台机器,然后具体哪个进程响应 不确定,
 * 所以,在注册/取消注册的时候,确定行为一致.
 * 
 */
/**
 * RPC函数 管理器,用于注册RPC方法,hook函数调用
 * 可以实现 宿主对象的方法及宿主对象的某个变量的某个方法 RPC化
 * @class ZWRPCMgr
 */
class ZWRPCMgr
{
    _rpc_timeout = 3000;//RPC调用超时..
    /**
     *Creates an instance of ZWRPCMgr.
     * @param {*} ctrobj,想要实现RPC的控制器对象
     * @param {ZWPeerMgr} peerprovider 节点提供者
     * @memberof ZWRPCMgr
     */
    constructor( ctrobj , peerprovider )
    {
        this._ctrobj        = ctrobj;
        this._peerprovider  = peerprovider;
    }
    /**
     * 发送RPC数据,目前使用的HTTP,如果要修改,继承这个方法
     *
     * @param {ZWRPCData} rpcdata
     * @returns {Promise<ZWRPCData>} 响应之后返回的数据
     * @memberof ZWRPCMgr
     */
    async sendRPC( rpcdata )
    {
        let retrpcdata = new ZWRPCData();
        Object.assign( retrpcdata,rpcdata );
        let callinfo = null;
        try
        {
            callinfo = this._peerprovider.getPeerForCall( rpcdata.func_unique_id );
            if( !callinfo )
            {//如果没有节点响应,那么自己响应
                return this.onRPC( rpcdata );
            }
            rpcdata.call_id = callinfo.callid;
            let reqoptions = {};
            let { call_path  } = this._getFuncIdInfo( rpcdata.func_unique_id );
            let url = 'http://' + callinfo.ip + call_path + '.rpc';
            let postdata        = {};
            postdata.client     = 'rpc';
            postdata.version    = '1.0';
            postdata.deviceid   = 'rpc_' + callinfo.ip;
            postdata.data       = rpcdata;

            reqoptions.timeout = this._rpc_timeout;
            reqoptions.method = 'POST';
            reqoptions.body = JSON.stringify( postdata );
            reqoptions.headers = {};
            reqoptions.headers['Content-Type'] = 'application/json';
            let r =  await fetch( url ,reqoptions );
            if( r )
            {
                r = await r.json();
                if( r.code == 0 )
                {   
                    retrpcdata =  r.data;
                }
                else 
                {
                    retrpcdata.errcode = 1;
                    retrpcdata.errmsg = 'RPC调用错误:' + r.msg;
                }
            }
            else 
            {
                retrpcdata.errcode = 1;
                retrpcdata.errmsg = 'RPC调用错误:未知网络错误';
            }
        }
        catch( e )
        {
            retrpcdata.errcode = 1;
            retrpcdata.errmsg = 'RPC调用异常:'+e.message;
        }
        if( callinfo )
            this._peerprovider.callResult( callinfo.ip,callinfo.callid,false );
        return Promise.resolve( retrpcdata );
    }
    /**
     * 收到RPC数据,目前使用的CTR的 http 方法响应数据,如果要修改,继承这个方法
     *
     * @param {ZWRPCData} rpcdata,收到的数据
     * @returns {Promise<ZWRPCData>} 响应之后返回的数据
     * @memberof ZWRPCMgr
     */
    async onRPC( rpcdata )
    {
        let retrpcdata = new ZWRPCData();
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
                Object.assign( retrpcdata , rpcdata );
                retrpcdata.errcode = 1;
                let var_obj = null;
                let reginfo = this._RPCFuncInfo.get( retrpcdata.func_unique_id );
                if( !reginfo )
                {
                    retrpcdata.errmsg = '未注册的RPC方法';
                    retrpcdata.errcode = 2;
                    break;
                }
                let { call_path ,var_name , func_name } = this._getFuncIdInfo( retrpcdata.func_unique_id );
                if( var_name === 'this' )
                    var_obj = this._ctrobj;
                else 
                    var_obj = this._ctrobj[ var_name ];
                
                if( !var_obj )
                {
                    retrpcdata.errmsg = '无效的变量名';
                    break;
                }
                /**
                 * @type Function
                 */
                let func = reginfo.org_func;
                if( !func || typeof func !== 'function' )
                {
                    retrpcdata.errmsg = '无效的RPC方法名字';
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

                retrpcdata = decode_func.call(var_obj,retrpcdata);

                let r  = func.apply(var_obj,retrpcdata.param_list);
                if( r && r instanceof Promise ) r = await r;
                retrpcdata.ret_data     = r;

                retrpcdata              = encode_func.call(var_obj,retrpcdata);
                retrpcdata.param_list   = [];
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
     * 注册之后,
     * @param {*} var_obj
     * @param {string|Function} funcname
     * @returns {boolean}
     * @memberof ZWBaseCtr
     */
    regRPC( var_obj , funcname )
    {
        if( funcname && typeof funcname == 'function' ) funcname = funcname.name;
        return this._rpcRU( var_obj,funcname,true);
    }

    /**
     * 变量/对象 删除注册RPC响应
     * @param {*} var_obj
     * @param {string|Function} funcname
     * @returns {boolean}
     * @memberof ZWBaseCtr
     */
    unRegRPC( var_obj , funcname )
    {
        if( funcname && typeof funcname == 'function' ) funcname = funcname.name;
        return this._rpcRU( var_obj,funcname,false);
    }

    /**
     * 添加/删除注册RPC响应
     * 
     * @param {*} var_obj
     * @param {string} funcname
     * @param {boolean} breg
     * @returns {boolean};
     * @memberof ZWBaseCtr
     */
    _rpcRU( var_obj , funcname , breg )
    {
        let func =  var_obj[ funcname ];
        if( !func || typeof func !== 'function' )
        {//如果根本没有对应方法,直接报错
            return false;
        }

        let var_name = this._getVarName(var_obj);
        if( var_name == null) return false;
        let func_id = this._makeFuncUniqueId( var_name , funcname );
        let t = this._RPCFuncInfo.get( func_id );
        if( breg )
        {
            //如果已经注册过了,直接返回成功了
            if( t ) return true;

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
            reginfo.hook_func = this._makeHookFunc( func ,var_name,funcname);
            reginfo.func_unique_id = this._makeFuncUniqueId( var_name,funcname);
            if( !reginfo.hook_func ) throw new Error('make rpc hook err');
            var_obj[ funcname ] = reginfo.hook_func;
            this._RPCFuncInfo.set( func_id,reginfo );
            
            //向节点管理表明我可以开始响应这个方法了,
            this._peerprovider.iCanResbThisFunc( reginfo.func_unique_id );
        }
        else
        {
            if( !t ) return true;
            //如果是之前被hook的,就还原
            var_obj[ funcname ] = t.org_func;
            this._RPCFuncInfo.delete( func_id );
            //向节点管理表明,我不再响应这个方法了,但是或许还有RPC进入,会自动切换到其他节点,
            this._peerprovider.iCanNotResbThisFunc( func_id );
        }
        return true;
    }
    _makeFuncUniqueId( var_name , funcname )
    {
        return this._ctrobj.getRouterPath() + '+' + var_name + '+' + funcname;
    }
    /**
     * 根据funcid获取变量名,方法名字
     *
     * @param {string} funcid
     * @memberof ZWRPCMgr
     */
    _getFuncIdInfo( funcid )
    {
        let a = funcid.split('+');
        if( a.length != 3 ) throw new Error('unkown funcid');
        return { call_path:a[0], var_name: a[1], func_name: a[2] };
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
    {
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
            rpcdata = var_obj.rpc_encode( rpcdata );
            rpcdata = await this.sendRPC( rpcdata );
            if( rpcdata.errcode == 0 )
            {
                rpcdata = var_obj.rpc_decode( rpcdata );
                return Promise.resolve( rpcdata.ret_data );
            }
            return Promise.reject( new Error(rpcdata.errmsg) );
        }
        catch(e)
        {
            throw e;
        }
    }


    /** 
     * 想要自动RPC化,就实现下面3个方法,然后注册就行了
     * 
    */

    /**
     * 编码RPC数据,主要就是把 param_list 编码
     *
     * @param {ZWRPCData} rpcdata
     * @returns {ZWRPCData} 
     * @memberof ZWBaseCtr
     */
    rpc_encode( rpcdata )
    {

    }

    /**
     * 解码RPC数据,主要就是把 ret_data 解码
     *
     * @param {ZWRPCData} rpcdata
     * @returns {ZWRPCData} 
     * @memberof ZWBaseCtr
     */
    rpc_decode( rpcdata )
    {

    }
    /**
     * 返回RPC管理器
     * @returns {ZWRPCMgr}
     * @memberof ZWRPCMgr
     */
    getRPCMgr()
    {

    }
}

module.exports.ZWRPCMgr     = ZWRPCMgr;
module.exports.ZWRPCData    = ZWRPCData;