const EventEmitter  = require('events');
const redis         = require("redis");
const { promisify } = require("util");
const ObjectID      = require('bson').ObjectId;
const   logger      = require('./zwlogger')
/**
 * RPC 调用协议数据
 * @class ZWRPCData
 */
class ZWRPCData
{
    /**
     * 一次RPC调用的超时时间,不能为0
     * 默认5秒
     * @memberof ZWRPCData
     */
    time_out            = ZWRPCBridge.st_rpc_default_timeout;
    /**
     * 一次调用的ID,标记一次调用
     *
     * @memberof ZWRPCData
     */
    call_id             = '';

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
    constructor( redis_url = 'redis://zw:123456@127.0.0.1:6379/0' )
    {
        super();
        this.redis_cfg = {};
        this.redis_cfg.url = redis_url;
        this._call_index = 0;
        this._bridgerid = (new ObjectID()).toHexString();
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
        this._pub_client.on( 'message', (channel, message) =>{
            this._recvFuncIdPublicMsg(channel, message);
        });
        /**
         * 数据输出的客户端
         */
        await this._startOutClient();
        /**
         * 数据输入的客户端
         */
        //这里之所以要分开,是因为如果同时执行多个命令,阻塞的命令会宕住非阻塞命令
        await this._startInClient();

        /**
         * 数据回复客户端
         */
        await this._startInResbClient();
        
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
    async _startInClient( )
    {
        this._in_client = redis.createClient( this.redis_cfg );
        return new Promise( (resolve,reject) => {
            this._in_client.on('ready',()=>{
                if( !this._in_client._started )
                {
                    this._in_client._started = true;
                    resolve(true);
                }
            });
            this._in_client.on('error',(e)=>{
                if( !this._in_client._started && !this._in_client._conn_err )
                {
                    this._in_client._conn_err = e;
                    reject(e);
                }
            });
        });
    }
    async _startInResbClient( )
    {
        this._in_resb_client = redis.createClient( this.redis_cfg );
        return new Promise( (resolve,reject) => {
            this._in_resb_client.on('ready',()=>{
                if( !this._in_resb_client._started )
                {
                    this._in_resb_client._started = true;
                    resolve(true);
                }
            });
            this._in_resb_client.on('error',(e)=>{
                if( !this._in_client._started && !this._in_resb_client._conn_err )
                {
                    this._in_resb_client._conn_err = e;
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
        //1.发送预先调用消息广播,通知可以响应的节点去监听数据了
        this._out_client.publish( rpcdata.func_unique_id , ZWRPCBridge.st_pub_msg_pre_call );
        //2.发送数据到指定的队列,让响应方抢
        rpcdata.call_id = this._makeCallID();
        this._out_client.rpush( rpcdata.func_unique_id + '_list_callout' , JSON.stringify(rpcdata) );
        //3.然后等待回执
        let _resb_key = rpcdata.call_id + '_list_resb';
        logger.log('wait call resb at',_resb_key);
        let r = await this._waitingCallResbCata( _resb_key , rpcdata.time_out );
        logger.log('wait call resb ok,',r);
        if(!r)
        {
            rpcdata.errmsg  = 'rpc超时';
            rpcdata.errcode = 1;
            return Promise.resolve( rpcdata );
        }
        return Promise.resolve( JSON.parse( r ) );
    }
    /**
     * 上层响应之后,将返回值回复给对方
     * 
     * @param {*} rpcdata
     * @memberof ZWRPCBridge
     */
    async resbDataForCall( rpcdata )
    {
        //根据callid找到对应的回复列表名字,将数据推入即可
        return new Promise( (resolve,reject) => {
            let _key = rpcdata.call_id + '_list_resb';
            let _time_out = rpcdata.time_out;
            logger.log('resb for call,',_key);
            this._out_client.rpush( _key , JSON.stringify(rpcdata) ,()=>{
                //如果有超时时间,那么这个回复数据的列表,也应该到时候清除了
                //这里不需要使用超时,redis删除策略自己删除老旧的数据
                //if( _time_out ) this._out_client.expire( _key , _time_out );
                resolve(true);
            });
        });
    }
    /**
     * 收到根据方法ID订阅的消息
     *
     * @param {*} channel
     * @param {*} message
     * @memberof ZWRPCBridge
     */
    async _recvFuncIdPublicMsg( channel, message )
    {
        do
        {
            if( message === ZWRPCBridge.st_pub_msg_pre_call )
            {
                //收到预先调用通知之后,马上去对应的消息队列抢消息来响应
                logger.log('wait call param');
                let r = await this._waitingCallInData( channel + '_list_callout' , ZWRPCBridge.st_rpc_default_timeout );
                if( !r ) break;//如果没有抢到就退出了
                logger.log('wait call param ok,',r);
                //如果抢到了数据,通知上层响应,上层响应之后调用 resbDataForCall 回复对方
                this.emit( ZWRPCBridge.st_event_rpc_on , JSON.parse(r) );
            }
            else
                break;
        }while(1);//一直循环抢数据,直到没有为止
        return Promise.resolve();
    }
    /**
     * 等待RPC调用进来的参数
     * @param {string} msg_list_name
     * @memberof ZWRPCBridge
     */
    async _waitingCallInData( msg_list_name , timeout )
    {
        return new Promise( (resolve,reject) => {
            this._in_client.blpop( msg_list_name , timeout, (e,v)=>{
                resolve(v?v[1]:null);
            })
        });
    }
    async _waitingCallResbCata( msg_list_name ,timeout )
    {
        return new Promise( (resolve,reject) => {
            this._in_resb_client.blpop( msg_list_name , timeout, (e,v)=>{
                resolve(v?v[1]:null);
            })
        });
    }
    _makeCallID()
    {
        this._call_index++;
        return this._bridgerid + '_' + process.pid + '_' + this._call_index;
    }
}
/**
 * RPC调用预先消息
 */
ZWRPCBridge.st_pub_msg_pre_call = 'pre_call';

/**
 * 有RPC请求到了,监听该事件可以响应
 */
ZWRPCBridge.st_event_rpc_on = 'on_rpc';

/**
 * 默认RPC超时时间,
 * 默认5秒
 */
ZWRPCBridge.st_rpc_default_timeout = 5;

module.exports.ZWRPCBridge  = ZWRPCBridge;
module.exports.ZWRPCData    = ZWRPCData;

