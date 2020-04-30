const EventEmitter  = require('events');
const redis         = require("redis");
const   logger      = require('./zwlogger')
const ZWSignalObject=  require('./zwthread').ZWSignalObject;


/**
 * RPC 调用协议数据
 * @class ZWRPCData
 */
class ZWRPCData
{
    /**
     * 一次调用的ID,标记一次调用
     *
     * @memberof ZWRPCData
     */
    call_id             = '';

    /**
     * 通过哪个通道调用过来的
     *
     * @memberof ZWRPCData
     */
    caller_bridge_id      = '';

    /**
     * 一个方法的唯一ID
     *
     * @memberof ZWRPCData
     */
    func_unique_id      = '';
    
    /**
     * 调用出去的参数列表
     *
     * @memberof ZWRPCData
     */
    param_list          = [];

    /**
     * 调用返回的数据
     *
     * @memberof ZWRPCData
     */
    ret_data            = null;
    /**
     * 数据调用发生的错误
     *
     * @memberof ZWRPCData
     */
    errmsg              = null;

    /**
     * 数据调用发生的错误码
     *
     * @memberof ZWRPCData
     */
    errcode             = 0;
}


/**
 * RPC调用的数据通道 
 * @class ZWRPCBridge
 * @extends {EventEmitter}
 */
class ZWRPCBridge extends EventEmitter
{
    constructor( lockip , redis_url = 'redis://zw:123456@127.0.0.1:6379/0')
    {
        super();
        this.redis_cfg = {};
        this.redis_cfg.url = redis_url;
        this._call_index = 0;
        this._redis_bridge_prefix = 'rpc_bridge:';
        this._bridgerid =  this._redis_bridge_prefix +  lockip + '_' + process.pid;

        /**
         * RPC调用超时,默认5秒
         */
        this._rpc_timeout   = 5;
        /**
         * 所以调用等待数据返回的信号对象
         */
        this._call_pending = {};
        this.setMaxListeners(0);
    }
    /**
     * 启动客户端连接
     * 
     * @returns {Promise<boolean>}
     * @memberof ZWRPCBridge
     */
    async start()
    {
        /**
         * 公共频道客户端
         */
        await this._startPubClient();

        this._pub_client.on( 'message', (channel, message ) => {
            let t = message?JSON.parse( message ) : {};
            if( t.cmd == ZWRPCBridge.st_pub_msg_pre_call ) return this._recvFuncIdPublicMsg(channel , t );
            if( t.cmd == ZWRPCBridge.st_pub_msg_resb_call ) return this._recvBridgePublicMsg(channel , t ); 
        });

        //关注自己通道的数据
        this._pub_client.subscribe( this._bridgerid );

        /**
         * 数据输出的客户端
         */
        await this._startOutClient();

        //这里客户端要分开,因为是 redis,里面的阻塞命令,会挡住后面的命令,所以需要分开,包括他的通知,

        return Promise.resolve(true);
    }
    async _startPubClient( )
    {
        this._pub_client = redis.createClient( this.redis_cfg );
        return new Promise( (resolve,reject) => {
            this._pub_client.on('ready',()=>{
                if( !this._pub_client._started )
                {
                    this._pub_client._started = true;
                    resolve(true);
                }
            });
            this._pub_client.on('error',(e)=>{
                if( !this._pub_client._started && !this._pub_client._conn_err )
                {
                    this._pub_client._conn_err = e;
                    reject(e);
                }
            });
        });
    }
    async _startOutClient( )
    {
        this._out_client = redis.createClient( this.redis_cfg );
        return new Promise( (resolve,reject) => {
            this._out_client.on('ready',()=>{
                if( !this._out_client._started )
                {
                    this._out_client._started = true;
                    resolve(true);
                }
            });
            this._out_client.on('error',(e)=>{
                if( !this._out_client._started && !this._out_client._conn_err )
                {
                    this._out_client._conn_err = e;
                    reject(e);
                }
            });
        });
    }
     
    /**
     * 我可以响应这个方法
     *
     * @param {string} funcid
     * @memberof ZWBasePeerMgr
     */
    iCanResbThisFunc( funcid )
    {
        this._pub_client.subscribe( funcid );
    }
    /**
     * 我不再响应这个方法
     *
     * @param {*} funcid
     * @memberof ZWBasePeerMgr
     */
    iCanNotResbThisFunc( funcid )
    {
        this._pub_client.unsubscribe( funcid );
    }
    /**
     * 发送数据到可以响应这个方法的进程,
     * 并且返回对方发送的返回数据
     * @param {ZWRPCData} data
     * @returns {Promise<ZWRPCData>}
     * @memberof ZWBasePeerMgr
     */
    async sendDataToWhoCanResb( rpcdata )
    {
        //1.发送数据到指定的队列,让响应方抢
        rpcdata.call_id = this._makeCallID();
        rpcdata.caller_bridge_id = this._bridgerid;
        this._out_client.rpush( rpcdata.func_unique_id + '_callin' , JSON.stringify(rpcdata) );

        //2.发送通知,让可以响应这个方法的去争抢响应
        let t = {};
        t.cmd = ZWRPCBridge.st_pub_msg_pre_call;
        this._out_client.publish( rpcdata.func_unique_id , JSON.stringify(t) );

        //3.等对方回复
        let s = new ZWSignalObject();
        this._call_pending[ rpcdata.call_id ] = s;
        let r = await s.wait( this._rpc_timeout * 1000 );
        if( !r )
        {//超时了
            rpcdata.errcode = 1;
            rpcdata.errmsg  = '对待回复超时';
            r = rpcdata;
        }
        delete this._call_pending[ rpcdata.call_id ];
        return Promise.resolve(r);
    }
    /**
     * 上层响应之后,将返回值回复给对方
     * 
     * @param {*} rpcdata
     * @memberof ZWRPCBridge
     */
    async resbDataForCall( rpcdata )
    {//用通知把数据返回就行了
        let t = {};
        t.cmd = ZWRPCBridge.st_pub_msg_resb_call;
        t.data = rpcdata;
        this._out_client.publish( rpcdata.caller_bridge_id  , JSON.stringify(t) );
    }
    /**
     * 收到根据方法ID订阅的消息
     *
     * @param {*} channel
     * @param {*} message
     * @memberof ZWRPCBridge
     */
    async _recvFuncIdPublicMsg( channel , recvdata )
    {
        do
        {
            //收到预先调用通知之后,马上去对应的消息队列抢消息来响应
            let r = await this._robCallInData( channel + '_callin' );
            if( !r ) break;//如果没有抢到就退出了
            //如果抢到了数据,通知上层响应,上层响应之后调用 resbDataForCall 回复对方
            this.emit( ZWRPCBridge.st_event_rpc_on , JSON.parse(r) );
        }while(1);

        //这里不能使用while(1) + blpop,否则如果同进程的情况下,blpop会挡住,直到超时,才轮到下个真正的数据blpop.
        //最终结果,这里不能使用阻塞命令,因为阻塞命令至少是1秒,如果有大量的通知到达,要排队执行,
        return Promise.resolve();
    }
    
    /**
     * 通常RPC调用返回数据用这个方式
     *
     * @param {*} channel
     * @param {*} message
     * @memberof ZWRPCBridge
     */
    async _recvBridgePublicMsg( channel , recvdata )
    {
        //收到了数据回复
        /**
         * @type ZWSignalObject
         */
        let wait_sig = this._call_pending [ recvdata.data.call_id ];
        if( !wait_sig )    return Promise.resolve( false );
        return Promise.resolve( wait_sig.notify( recvdata.data ) );
    }
    /**
     * 抢 RPC调用进来的参数
     * @param {string} msg_list_name
     * @memberof ZWRPCBridge
     */
    async _robCallInData( msg_list_name  )
    {
        return new Promise( (resolve,reject) => {
            this._out_client.lpop( msg_list_name, (e,v)=>{
                resolve(v);
            })
        });
    }
    _makeCallID()
    {
        return this._call_index++;
    }
}
/**
 * RPC调用预先消息
 */
ZWRPCBridge.st_pub_msg_pre_call = 'pre_call';


/**
 * RPC调用返回消息
 */
ZWRPCBridge.st_pub_msg_resb_call = 'resb_call';


/**
 * 有RPC请求到了,监听该事件可以响应
 */
ZWRPCBridge.st_event_rpc_on = 'on_rpc';

module.exports.ZWRPCBridge  = ZWRPCBridge;
module.exports.ZWRPCData    = ZWRPCData;

