
const   dgram       = require('dgram');
const   Socket      = dgram.Socket;
const   OS          = require('os');
const   logger      = require('./zwlogger')

/**
 * 这里节点使用P2P方式,不使用注册中心统一维护
 * 将使用广播功能,所以只能内网使用
 * 
 * P2P消息只需要主进程进行,其他负载均衡的进程和主进程通信就够了
 * 比如,使用cluster方式启动的进程,P2P重点是发现对方IP就够了
 * @class ZWPeerMgr
 */
class ZWPeerMgr
{
    /**
     * ip映射节点
     *
     * @memberof ZWPeerMgr
     */
    _ipmappeer = {};


    /**
     * 调用开始记录
     * @memberof ZWPeerMgr
     */
    _callstartat = {};

    /**
     * Socket对象
     * @type {Socket}
     */
    _socket;
    

    _main_port;

    /**
     * 自己的节点对象
     * @type {ZWPeer}
     * @memberof ZWPeerMgr
     */
    _self;


    /**
     * 广播频率,默认一分钟一次
     *
     * @memberof ZWPeerMgr
     */
    _broadcastgap = 1000*60 *1;

    /**
     * 节点超时时间
     *
     * @memberof ZWPeerMgr
     */
    _peerttlms      = 1000*60 *2;//2分钟就超时了
    

    _localip        = '';


    _isMain = false;

    /**
     * 从进程的端口号
     *
     * @memberof ZWPeerMgr
     */
    _slave_ports  = new Set();

    constructor( main_socket, mainport , peerlabel = '' )
    {
        if( !mainport && !main_socket ) throw new Error('must have one...');
        if( ZWPeerMgr._shareinstacne ) throw new Error('single obj class!');
        ZWPeerMgr._shareinstacne = this;
        this._localip = this.getIP();

        this._main_port = mainport;
        this._socket = main_socket;
        this._isMain = main_socket != null;
        if( this._isMain )
        {
            this._socket.setBroadcast(true);
            let _ip = this._socket.address().address;
            //如果监听的是所有地址那么 就替换到本机真正地址
            if( _ip === '0.0.0.0' ) _ip = this._localip;

            //如果是主进程就把自己放入节点记录
            this._self = new ZWPeer( _ip , this._socket.address().port, peerlabel );
            this._ipmappeer[this._self.ip] =  this._self;
        }
        else
        {
            this._socket = dgram.createSocket('udp4');
            this._socket.bind();//这里随便绑定一个端口就行了
            this._self = new ZWPeer( this._localip , 0, peerlabel );
        }
    }

    static shareClient()
    {
        return ZWPeerMgr._shareinstacne;
    }
    async start()
    {
        this._socket.on('message',(msg,rinfo)=>{ this._recvMsg(msg,rinfo)});
        this._loop();
        return Promise.resolve(true);
    }
    /**
     * 添加当前节点支持的响应方法ID
     * 
     * @param {*} funcid
     * @memberof ZWPeerMgr
     */
    iCanResbThisFunc( funcid )
    {
        this._self.funcIDs.add( funcid );
        return true;
    }
    iCanNotResbThisFunc( funcid )
    {
        this._self.funcIDs.delete( funcid );
    }

    /**
     * 获取节点用于执行这个RPC 调用
     * 目前策略就是随机获取
     * @param {string} funcid
     * @param {string} [label=null]
     * @returns {} 如果没有找到返回空
     * @memberof ZWPeerMgr
     */
    getPeerForCall( funcid ,label = null )
    {
        let ks = Object.keys( this._ipmappeer );
        if( !ks || !ks.length ) return null;

        //找个随机位置开始获取节点
        let r = Math.random() * 1000;
        r = r.toFixed(0);
        r = r % ks.length;
        while( r-- )
        {
            ks.push(ks.shift());
        }
        
        let p = null;
        let now = new Date();
        let diff = 0;

        for( let ip of ks )
        {
            /**
             * @type ZWPeer
             */
            let one = this._ipmappeer[ ip ];

            diff = now.getTime() - one.updateat.getTime();
            if( diff > this._peerttlms )
            {//超时了就删除了
                delete this._ipmappeer[ip];
                delete this._callstartat[ip];
                continue;
            }
            //如果该节点不响应这个方法,不要
            if( !one.funcIDs.has(funcid) ) continue;
            //如果指定的标签服务器不对,也不要
            if( label && one.label !== label ) continue;
            p = one;
            break;
        }
        if( !p ) return null;
        let ret = {ip:p.ip,callid:p.makeCallId()};
        if( !this._callstartat[ ret.ip ] )  this._callstartat[ ret.ip ] = {};
        this._callstartat[ ret.ip ][ ret.callid ] =  new Date();
        return ret;
    }

    /**
     *统计调用结果
     *
     * @param {string} ip
     * @param {number} callid
     * @param {boolean} bok
     * @memberof ZWPeerMgr
     */
    callResult( ip, callid , bok )
    {
        if( !this._callstartat[ip] ) return;

        let n       = new Date();
        let at      = this._callstartat[ip][callid];
        if( !at ) return;
        delete this._callstartat[ip][callid];
        let diff    = n.getTime() - at.getTime();

        /**
         * @type {ZWPeer}
         */
        let peer = this._ipmappeer[ip];

        let one     = peer._mintueST;
        if( (n.getTime() - one.createat.getTime()) > 1000*60 )
        {//超时了,重新生成一个
            peer._mintueST = new ZWPeerStatisic();
            one = peer._mintueST;
        }

        one.call_total_ms += diff;
        one.call_count += 1;
        one.call_succ  += (bok?1:0);
        one.call_fail  += (!bok?1:0);
        one.call_avg_ms = one.call_total_ms / one.call_count;
        one.call_avg_ms = one.call_avg_ms.toFixed(0);

        one = peer._allST;

        one.call_total_ms += diff;
        one.call_count += 1;
        one.call_succ  += (bok?1:0);
        one.call_fail  += (!bok?1:0);
        one.call_avg_ms = one.call_total_ms / one.call_count;
        one.call_avg_ms = one.call_avg_ms.toFixed(0);

    }

    /**
     * 返回所有的节点列表
     *
     * @returns {[]}
     * @memberof ZWPeerMgr
     */
    getAllPeers()
    {
        return Object.values( this._ipmappeer );
    }

    async _loop()
    {
        try
        {
            await this._broadmyself();
            this._timer = setTimeout(()=>{return this._loop()}, this._broadcastgap);
        }
        catch(e)
        {

        }
        return Promise.resolve();
    }
    async _broadmyself()
    {
        if( this._isMain )
        {//如果是主进程则需要广播自己
            this._self.getMachineStatus();
            return new Promise( (resolve,reject) => {
                let msg = JSON.stringify( this._self );
                this._socket.send( msg , this._self.port , '255.255.255.255',(err)=>{
                    resolve(err==null);
                });
            });
        }
        else 
        {//如果不是主进程,只需要和主进程联系,获取节点
            return new Promise( (resolve,reject) => {
                let msg = {};
                msg.iam = 'slave';
                this._socket.send( JSON.stringify( msg ) , this._main_port , this._self.ip,(err)=>{
                    resolve(err==null);
                });
            });
        }
    }

    /**
     * 接收数据,
     * 
     * @param {Buffer} msg
     * @param {*} rinfo
     * @memberof ZWPeerMgr
     */
    _recvMsg(msg,rinfo)
    {
        try
        {
            do
            {
                //不是iPV4不要
                if( rinfo.family !== 'IPv4' )
                {
                    break;
                }
                //收到了自己广播的数据,不要
                if( rinfo.address == this._self.ip && rinfo.port == this._self.port ) break;
                if( !msg ) break;
                let datstr  = msg.toString('utf8');
                if( !datstr || !datstr.length ) break;
                let recvobj = JSON.parse(datstr);
                if( !recvobj ) break;
                if( this._isMain && recvobj.iam === 'slave' && rinfo.address === this._localip )
                {
                    this._slave_ports.add( rinfo.port );
                    this._reBackSlave( rinfo.port );
                    break;
                }
                if( !this._isMain && recvobj.peerlist )
                {
                    this._recvMainPeerList( recvobj.peerlist );
                    break;
                }

                if( recvobj.ip !== rinfo.address ) break;
                
                if( !this.isSameNetArea( this._self.ip, recvobj.ip ) ) break;

                let recvpeer = this._ipmappeer[recvobj.ip];
                if( !recvpeer )
                {
                    recvpeer = new ZWPeer();
                    this._ipmappeer[recvpeer.ip] = recvpeer;
                }
                Object.assign( recvpeer , recvobj );
                recvpeer.updateat = new Date();
            }while( 0 );
        }
        catch(e)
        {
            logger.error('recv msg err:',e.message);
        }
    }

    //将所有节点信息发送给其他进程
    async _reBackSlave(port)
    {
        //这里不一个一个发送了,直接一次性全部发送
        return new Promise( (resolve,reject) => {
            let msg = JSON.stringify( {peerlist: Object.values( this._ipmappeer ) });
            this._socket.send( msg , port , this._localip ,(err)=>{
                resolve(err==null);
            });
        });
    }
    //从进程收到所有节点数据
    _recvMainPeerList( peerlist )
    {
        for( let one of peerlist )
        {
            let recvpeer = new ZWPeer();
            Object.assign( recvpeer , one );
            this._ipmappeer[recvpeer.ip] = recvpeer;
        } 
    }

    /**
     * 获取本机IP地址,
     *
     * @returns {string}
     * @memberof ZWPeerMgr
     */
    getIP()
    {
        let i = this.getIPInterface();
        if( !i ) return null;
        return i.address;
    }
    /**
     * 获取当前IP的接口 对象
     *
     * @memberof ZWPeerMgr
     */
    getIPInterface()
    {
        let allips = OS.networkInterfaces();
        for( let oneinterface of Object.values( allips) )
        {
            for( let one of oneinterface )
            {
                if( one.internal || one.family === 'IPv6' ) continue;
                return one;
            }
        }
        return null;
    }

    /**
     * 获取网络号前缀位数
     *
     * @returns
     * @memberof ZWPeerMgr
     */
    getNetIdBits()
    {
        let i = this.getIPInterface();
        if( !i ) return 0;
        let b = i.cidr.split('/')[1];
        if( !isNaN(b) ) return new Number(b);
        return 0;
    }

    /**
     * 获取IP 的主机号,
     *
     * @param {string} ip
     * @returns
     * @memberof ZWPeerMgr
     */
    getNetHostID( ip )
    {
        let bit = this.getNetIdBits();
        if( !bit || bit > 32 ) return 0;
        let a = ip.split('.');
        if( a.length != 4 ) return 0;
        let s = '';
        for( let i = 0 ; i < 4;i++ )
        {
            s   += (parseInt(a[i]).toString(2)+'');
        }
        s = s.substr( bit );
        return parseInt( s , 2);
    }
    /**
     * 是否同一网段
     *
     * @param {string} ip
     * @param {string} ip2
     * @param {number} netmaskbits,网段掩码位数,默认取本地IP网段
     * @returns {boolean} 是否本地同一网段
     * @memberof ZWPeer
     */
    isSameNetArea( ip , ip2 ,netmaskbits = 0 )
    {
        if( ip === ip2 ) return true;
        let bit = netmaskbits;
        if( bit == 0 || bit > 32 ) this.getNetIdBits();
        if( !bit || bit > 32 ) return false;
        let a = ip.split('.');
        if( a.length != 4 ) return false;
        let b = ip2.split('.');
        if( b.length != 4 ) return false;

        let _0_ = [ '0000000',
                    '000000',
                    '00000',
                    '0000',
                    '000',
                    '00',
                    '0',
                    '' ];
        let s = '',s2 = '';
        for( let i = 0 ; i < 4;i++ )
        {
            let t = parseInt(a[i]).toString(2)+'';
            s   += (_0_[t.length-1] + t);
            t = (parseInt(b[i]).toString(2)+'');
            s2  += (_0_[t.length-1] + t);
        }
        s = s.substr(0,bit);
        s2 = s2.substr(0,bit);
        return s === s2;
    }

}

ZWPeerMgr._shareinstacne = null;

/**
 * 一个节点
 *
 * @class ZWPeer
 */
class ZWPeer
{
    constructor( ip, port , label = '')
    {
        this.label  = label;
        this.ip     = ip;
        this.port   = port;
        this.version = '1.0';

        this.funcIDs.toJSON = ()=>{
            let t = [];
            for( let one of this.funcIDs.values() )
            {
                t.push( one );
            }
            let obj = { 'funcIDs' : t };
            return JSON.stringify( obj );
        };
    }

    /**
     * 版本号
     *
     * @memberof ZWPeer
     */
    version = '1.0';

    /**
     * 节点ip
     * @type {string}
     * @memberof ZWPeer
     */
    ip = '';


    /**
     * 节点接收数据的端口
     *
     * @memberof ZWPeer
     */
    port = 0;


    /**
     * 节点标签,可用作分类归类
     * @type {string}
     * @memberof ZWPeer
     */
    label = '';

    /**
     * 节点创建时间
     * @type {Date}
     * @memberof ZWPeer
     */
    createat  = new Date();


    updateat  = new Date();

    /**
     * 节点忙碌情况,值越大越忙碌
     * @type {number}
     * @memberof ZWPeer
     */
    busy = 0.0;

    /**
     * 剩余内存
     * @type {number}
     * @memberof ZWPeer
     */
    freemem = 0;


    /**
     * 该节点支持RPC的所有方法ID
     * @type Set<string>
     * @memberof ZWPeer
     */
    funcIDs = new Set();

    /**
     * RPC callid,简单处理一个数字就行了
     *
     * @memberof ZWPeer
     */
    _callid = 0;

    /**
     * 生成RPC用的callid,用于验证和统计
     *
     * @returns {number}
     * @memberof ZWPeer
     */
    makeCallId()
    {
        this._callid++;
        return this._callid;
    }
    

    /**
     * 最近一分钟的统计情况
     * @type {ZWPeerStatisic}
     * @memberof ZWPeer
     */
    _mintueST = new ZWPeerStatisic();

    
    /**
     * 累计统计情况
     * @type {ZWPeerStatisic}
     * @memberof ZWPeer
     */
    _allST = new ZWPeerStatisic();


    /**
     * 获取本机状态
     *
     * @memberof ZWPeer
     */
    getMachineStatus()
    {
        this.busy = OS.loadavg()[0];
        this.freemem = OS.freemem();
        this.updateat = new Date();
    }
}

class ZWPeerStatisic
{

    createat = new Date();
    /**
     * 平均耗时
     *
     * @memberof ZWPeerStatisic
     */
    call_avg_ms = 0;

    /**
     * 调用总共耗时
     *
     * @memberof ZWPeerStatisic
     */
    call_total_ms = 0;

    /**
     * 总共被调用了多少次
     *
     * @memberof ZWPeerStatisic
     */
    call_count = 0;

    /**
     * 成功次数
     *
     * @memberof ZWPeerStatisic
     */
    call_succ = 0;

    /**
     * 失败次数
     *
     * @memberof ZWPeerStatisic
     */
    call_fail = 0;

    /**
     * 成功率
     *
     * @memberof ZWPeerStatisic
     */
    call_succ_rate = 0.0;
}

module.exports.ZWPeerMgr = ZWPeerMgr;