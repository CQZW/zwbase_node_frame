
const   dgram       = require('dgram');
const   Socket      = dgram.Socket;
const   OS          = require('os');
const   logger      = require('./zwlogger');
const EventEmitter  = require('events');
const ZWSignalObject=  require('./zwthread').ZWSignalObject;
/**
 * 这里节点使用P2P方式,不使用注册中心统一维护
 * 将使用广播功能,所以只能内网使用
 * 
 * P2P消息只需要主进程进行,其他负载均衡的进程和主进程通信就够了
 * 
 * @class ZWPeerMgr
 */
class ZWPeerMgr  extends EventEmitter
{
    /**
     * ip映射远程 节点
     *
     * @memberof ZWPeerMgr
     */
    _remote_peers = {};

    /**
     * port 映射本地进程节点
     *
     * @memberof ZWPeerMgr
     */
    _local_peers = {};

    /**
     * Socket对象
     * @type {Socket}
     */
    _socket;
    
    /**
     * 主进程端口
     *
     * @memberof ZWPeerMgr
     */
    _main_port;

    /**
     * 自己的节点对象
     * @type {ZWPeer}
     * @memberof ZWPeerMgr
     */
    _self;

    /**
     * 发送远程的节点,和self区别开来
     * @type ZWPeer
     * @memberof ZWPeerMgr
     */
    _post_to_remote_peer;

    /**
     * 广播频率,默认一分钟一次
     *
     * @memberof ZWPeerMgr
     */
    _broadcast_gapms = 1000*60 *1;

    /**
     * 节点超时时间,多久没有收到广播就超时
     * 默认3分钟
     * @memberof ZWPeerMgr
     */
    _peer_alive_timeoutms      = 1000*60 *3;
    
    /**
     *如果节点失败率过高暂停之后多久可以重试,默认15秒
     *
     * @memberof ZWPeerMgr
     */
    _retry_delayms  = 1000 * 15;

    /**
     * 本机IP
     *
     * @memberof ZWPeerMgr
     */
    _localip        = '';

    /**
     * 是否是主进程,是指能和其他机器通讯的进程
     *
     * @memberof ZWPeerMgr
     */
    _isMain = false;

    /**
     * 用于组成进程间的唯一ID
     *
     * @memberof ZWPeerMgr
     */
    _ipc_ack = 0;

    /**
     * IPC调用等待记录
     * ack 映射 等待对象
     * @memberof ZWPeerMgr
     */
    _ipc_pending = {};

    /**
     * IPC超时,毫秒,默认5秒
     *
     * @memberof ZWPeerMgr
     */
    _ipc_timeoutms = 5000;

    constructor( main_socket, mainport , peerlabel = '' )
    {
        super();
        if( !mainport && !main_socket ) throw new Error('must have one...');
        if( main_socket && main_socket.address().port != mainport ) throw new Error('main port not eq main socket port');
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
            if( _ip == '0.0.0.0' ) _ip = this._localip;

            this._self = new ZWPeer( _ip , mainport , peerlabel );
            //将自己放入本地节点记录
            this._local_peers[ mainport ] = this._self;

            this._post_to_remote_peer = new ZWPeer(_ip , mainport , peerlabel );
        }
        else
        {
            this._self = new ZWPeer( this._localip , 0, peerlabel );
            this._socket = dgram.createSocket('udp4');
        }
    }
    async _bind()
    {
        return new Promise( (resolve,reject)=>{
            this._socket.on('listening',()=>{
            this._self.port = this._socket.address().port;//这里才真正获取了端口
                resolve(true);
            });
            this._socket.bind();//这里随便绑定一个端口就行了
        });
    }

    static shareClient()
    {
        return ZWPeerMgr._shareinstacne;
    }

    async start()
    {
        this._socket.on('message',(msg,rinfo)=>{ this._recvMsg(msg,rinfo)});
        if( !this._isMain ) await this._bind();
        await this._loop();
        return Promise.resolve(true);
    }

    async _loop()
    {
        try
        {
            let now = new Date();
            let bchanged = false;
            //1.首先检查本地节点是否有超时了的,
            let a = Object.keys( this._local_peers );
            for( let port of a )
            {
                /**
                 * @type ZWPeer
                 */
                let p = this._local_peers[ port ];
                let diff = now.getTime() - p.updateat.getTime();
                if( diff > this._peer_alive_timeoutms )
                {//如果超时就删除了
                    delete this._local_peers[port];
                    bchanged = true;
                }
            }
            //2.检查远程节点是否有超时的
            a = Object.keys( this._remote_peers );
            for( let ip of a )
            {
                /**
                 * @type ZWPeer
                 */
                let p = this._remote_peers[ ip ];
                let diff = now.getTime() - p.updateat.getTime();
                if( diff > this._peer_alive_timeoutms )
                {//如果超时就标记为
                    p.status = 2;
                    bchanged = true;
                }
            }
            //3.广播自己
            if( bchanged )//如果数据有变化,要通知远端还要通知本地的其他进程,
                await this._notifyChnage();
            else //如果数据没有变化,只是普通报活而已
                await this._broadcastmyself();
        }
        catch(e)
        {
            logger.error("peermgr _loop failed:",e.message);
        }
        setTimeout(()=>{return this._loop()}, this._broadcast_gapms );
        return Promise.resolve();
    }
    async _broadcastmyself()
    {
        this._self.getMachineStatus();
        if( this._isMain )
        {//广播给其他节点,需要将整个机器响应的方法都告诉别人
            for( let one of Object.values( this._local_peers ) )
            {
                this._combineResbFuncForRemote( one );
            }
            this._post_to_remote_peer.getMachineStatus();
            return this._sendData( ZWPeerMgr.st_cmd_post_peer_to_all , this._post_to_remote_peer.copyToSend() );
        }
        //如果是从进程,只需要向主进程复制数据
        return this._sendData( ZWPeerMgr.st_cmd_slave_wants_copy, this._self );
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
                if( !msg ) break;
                let datstr  = msg.toString('utf8');
                if( !datstr || !datstr.length ) break;
                let recvobj = JSON.parse(datstr);
                if( !recvobj ) break;
                let recvdata = recvobj.data;
                if( recvobj.cmd == ZWPeerMgr.st_cmd_post_peer_to_all )
                {//收到了广播节点的数据
                    if( !this._isMain ) break;
                    if( recvdata.status == 3 )
                    {//直接删除
                        delete this._remote_peers[recvdata.ip];
                        this._reBackSlave(0);//收到节点应该立马通知所有的从节点
                        break;
                    }
                    let recvpeer = this._remote_peers[recvdata.ip];
                    if( !recvpeer )
                    {
                        recvpeer = new ZWPeer();
                        this._remote_peers[recvdata.ip] = recvpeer;
                    }
                    recvpeer.assignFrom( recvdata );
                    recvpeer.updateat = new Date();
                    this._reBackSlave(0);//收到节点应该立马通知所有的从节点
                    break;
                }
                if( recvobj.cmd == ZWPeerMgr.st_cmd_slave_wants_copy )
                {//收到了 从进程获取所有节点的请求
                    if( !this._isMain ) break;
                    /**
                     * @type {ZWPeer}
                     */
                    let p = this._local_peers[rinfo.port];
                    if( !p ) {p = new ZWPeer();this._local_peers[rinfo.port] = p}
                    p.assignFrom(recvdata);
                    this._reBackSlave( rinfo.port );
                    break;
                }
                if( recvobj.cmd == ZWPeerMgr.st_cmd_post_copy_to_slave )
                {//收到了 主进程发送的节点列表
                    if( this._isMain ) break;
                    this._recvMainCopy( recvdata );
                    break;
                }
                if( recvobj.cmd == ZWPeerMgr.st_cmd_slave_peer_changed )
                {
                    if( !this._isMain ) break;
                    //如果从进程有变化了,应该里面通知其他从进程,和远端的节点
                    let p = this._local_peers[rinfo.port];
                    if( !p ) {p = new ZWPeer();this._local_peers[rinfo.port] = p}
                    p.assignFrom(recvdata);
                    this._broadcastmyself();
                    break;
                }
                if( recvobj.cmd == ZWPeerMgr.st_cmd_ipc_data_send )
                {//收到IPC数据,通知业务层处理,业务层尽快调用 resbDataIPC 回复 对方,否则会超时
                    this.emit( 'ipc_data' , recvobj );
                    break;
                }
                if( recvobj.cmd == ZWPeerMgr.st_cmd_ipc_data_resb )
                {//收到IPC 回复的数据,找到等待的信号对象,进行通知
                    this._ipc_pending[ recvobj.ack ].notify( recvdata );
                    break;
                }
                logger.error('invaild cmd:', recvobj.cmd );
                break;
            }while( 0 );
        }
        catch(e)
        {
            logger.error('recv msg err:',e.message);
        }
    }
    /**
     * 通知其他节点/进程有变化了
     * @memberof ZWPeerMgr
     */
    async _notifyChnage()
    {
        if( this._isMain )
        {//如果是主进程数据发送了变化,直接广播,
            return this._broadcastmyself();
        }
        //如果是从进程变化了,就告诉主进程,主进程会自己广播,并且通知 其他 进程
        return this._sendData( ZWPeerMgr.st_cmd_slave_peer_changed , this._self );
    }
    /**
     * 合并这个机器可以响应的所有方法,用于告诉远程节点
     *
     * @param {ZWPeer} peer
     * @returns
     * @memberof ZWPeerMgr
     */
    _combineResbFuncForRemote( peer )
    {
        if( !this._post_to_remote_peer ) return;
        for( let k of Object.keys( peer.funcIDs ) )
        {
            if( peer.funcIDs[k] )
                this._post_to_remote_peer.funcIDs[ k ] = 1;
            else
                delete this._post_to_remote_peer.funcIDs[ k ];
        }
    }
    //将所有节点信息发送给其他进程
    async _reBackSlave( port = 0 )
    {
        if( port == 0 )
        {
            let a = Object.keys( this._local_peers );
            let e = null;
            for( let one of a )
            {
                if( isNaN( one ) ||  one == 0 ) continue;
                e = await this._reBackSlave( parseInt(  one ) );
                if( e ) break;
            }
            return Promise.resolve( e );
        }
        let x = {};
        x.remote_peers  = Object.values( this._remote_peers );
        x.local_peers   = this._local_peers;
        return this._sendData( ZWPeerMgr.st_cmd_post_copy_to_slave , x , port );
    }

    //从进程收到主进程的复制数据
    _recvMainCopy( copydata  )
    {
        //数据包括 远端机器节点 和本机其他进程
        for( let one of copydata.local_peers )
        {
            /**
             * @type ZWPeer
             */
            let recvpeer = this._local_peers[one.port];
            if( !recvpeer )
            {
                recvpeer = new ZWPeer();
                this._local_peers[one.port] = recvpeer;
            }
            recvpeer.assignFrom( one );
        }
        for( let one of copydata.remote_peers )
        {
            /**
             * @type ZWPeer
             */
            let recvpeer = this._remote_peers[one.ip];
            if( !recvpeer )
            {
                recvpeer = new ZWPeer();
                this._remote_peers[one.ip] = recvpeer;
            }
            recvpeer.assignFrom( one );
        }
    }

    async _sendData( cmd , datobj ,port = this._main_port )
    {
        if( typeof datobj != 'object' ) throw new Error('send dat must object');
        if( cmd == ZWPeerMgr.st_cmd_ipc_data_send || cmd == ZWPeerMgr.st_cmd_ipc_data_resb ) throw new Error('can not do it here');

        let sendobj = {};
        sendobj.cmd = cmd;
        sendobj.data = datobj;
        if( cmd == ZWPeerMgr.st_cmd_post_peer_to_all )
        {
            return new Promise( (resolve,reject) => {
                this._socket.send( JSON.stringify( sendobj ) , port , '255.255.255.255',(err)=>{
                    resolve(err);
                });
            });
        }
        return new Promise( (resolve,reject) => {
            this._socket.send( JSON.stringify( sendobj ) , port , this._localip ,(err)=>{
                resolve(err);
            });
        });
    }
    /**
     * 
     * 将节点暂时挂起,不使用
     * @param {ZWPeer} peer
     * @returns
     * @memberof ZWPeerMgr
     */
    hangUp( peer )
    {
        if( this._checkPeer( peer ) ) return;
        peer.status = 1;
    }

    /**
     * 检查节点情况,如果有问题,删除该节点
     *
     * @param {ZWPeer} peer
     * @returns {boolean} 返回是否健康,false就需要删除了
     * @memberof ZWPeerMgr
     */
    _checkPeer( peer )
    {
        return true;
        //如果连续失败5次就删除这个节点,
        if( peer._allST.call_fail_contine_count > 5 ) return false;
        //如果最近1分钟成功率 < %50了,
        if( peer._allST.call_succ_rate < 0.51 ) return false;

        return true;
    }
    /**
     *当前进程是否可以响应者请求,
     *
     * @param {string} funcid
     * @returns {boolean}
     * @memberof ZWPeerMgr
     */
    isThisProcCanResb( funcid )
    {
        return this._self.funcIDs[ funcid ] == process.pid;
    }

    /**
     * 添加当前节点支持的响应方法ID
     * @param {string} funcid
     * @memberof ZWPeerMgr
     */
    iCanResbThisFunc( funcid )
    {
        this._self.funcIDs[ funcid ] = process.pid;
        this._notifyChnage();
        return true;
    }

    /**
     * 删除当前节点响应的方法
     *
     * @param {*} funcid
     * @memberof ZWPeerMgr
     */
    iCanNotResbThisFunc( funcid  )
    {
        this._self.funcIDs[ funcid ] = 0;
        this._notifyChnage();
    }

    /**
     * 获取节点用于执行这个RPC 调用
     * 目前策略就是随机获取
     * @param {string} funcid
     * @param {boolean} bremote ,是否获取远程节点
     * @param {string} [label=null]
     * @returns {ZWPeer} 
     * @memberof ZWPeerMgr
     */
    getPeerForCall( funcid , bremote = true ,label = null )
    {
        let tagwaper = bremote ? this._remote_peers : this._local_peers;
        let ks = Object.keys( tagwaper );
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

        for( let k of ks )
        {
            /**
             * @type ZWPeer
             */
            let one = tagwaper[ k ];
            //如果该节点不响应这个方法,不要
            if( !one.funcIDs[funcid] ) continue;

            //如果指定的标签服务器不对,也不要
            if( label && one.label !== label ) continue;

            if( one.status == 1 )
            {//失败率过高的节点,重试下
                diff = now.getTime() - one._touch_at.getTime();
                if( diff < this._retry_delayms ) continue;
                one.status = 0;//如果可以重试了,恢复正常
            }
            else if( one.status != 0 ) continue;
            p = one;
            break;
        }
        return p;
    }
    /**
     * 判断一个节点是否是本地节点
     *
     * @param {ZWPeer} p
     * @returns
     * @memberof ZWPeerMgr
     */
    isLocalPeer( p )
    {
        return this._localip == p.ip;
    }

    /**
     * 返回所有的节点列表
     *
     * @returns {}
     * @memberof ZWPeerMgr
     */
    getAllPeers()
    {
        let r = {};
        r.remote = Object.values( Object.values( this._remote_peers ) );
        r.local = Object.values( Object.values( this._local_peers ) );
        return r;
    }
    /**
     * 删除节点
     *
     * @param {ZWPeer} peer
     * @returns
     * @memberof ZWPeerMgr
     */
    async removePeer( peer )
    {
        //删除动作比较特殊,可以直接广播数据,因为收到数据就是简单的删除
        peer.status = 3;
        peer.getMachineStatus();
        if( this._isMain )
        {
            return this._sendData( ZWPeerMgr.st_cmd_post_peer_to_all , peer );
        }
        else
        {
            let s = {};
            s.cmd   = ZWPeerMgr.st_cmd_post_peer_to_all;
            s.data  = peer;

            return new Promise( (resolve,reject) => {
                const tmpsocket = dgram.createSocket('udp4');
                tmpsocket.setBroadcast(true);
                tmpsocket.send( JSON.stringify( s ) , this._main_port , '255.255.255.255',(err)=>{
                    resolve(err);
                });
            });
        }
    }

    /**
     * 使用UDP进行进程间通信,发送数据
     *
     * @param {*} port
     * @param {*} data
     * @param {number} [subytpe=0] subtype 业务类型;默认0 是进行进程间RPC
     * @returns {Promise}; { e:err,d:xx}
     * @memberof ZWPeerMgr
     */
    async sendDataIPC( port , data , subtype = 0 )
    {
        let r = {};
        let r_port = parseInt( port );
        if( isNaN( port) || port <= 0 )
        {
            r.e = 'IPC响应者端口异常';
            return Promise.resolve( r );
        }
        
        let _ack = this._socket.address().port + '_' + this._ipc_ack++;
        let x = {};
        x.cmd       = ZWPeerMgr.st_cmd_ipc_data_send;
        x.data      = data;
        x.ack       = _ack;
        x.subtype   = subtype;

        let s = new ZWSignalObject();
        this._ipc_pending[ _ack ] = s;
        this._socket.send( JSON.stringify( x ) , r_port , this._localip ,(err)=>{
            if( !err ) return;
            let rr = { e:err,d:null };
            let ss = this._ipc_pending[ _ack ];
            if( ss ) ss.notify( rr );
        });
        r = await s.wait( this._ipc_timeoutms );
        if( r == null ) r = {e:'IPC连接超时'};
        delete this._ipc_pending[ _ack ];

        return Promise.resolve( r );
    }

    /**
     * 使用UDP进行进程间通信,回复数据
     *
     * @param {*} ack-回执
     * @param {*} data-返回的数据
     * @param {*} [err=null],错误信息,否则为null
     * @returns {Promise<stirng>} 返回错误信息,null表示成功
     * @memberof ZWPeerMgr
     */
    async resbDataIPC( ack , data , err = null )
    {
        let x = {};
        x.cmd       = ZWPeerMgr.st_cmd_ipc_data_resb;
        x.data      = {e:err,d:data };
        x.ack       = ack;
        return new Promise( (resolve,reject)=>{
            this._socket.send( JSON.stringify( x ) , ack.split('_')[0] , this._localip ,(err)=>{
                resolve( err );
            });
        });
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
                if( one.internal || one.family == 'IPv6' ) continue;
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
        if( ip == ip2 ) return true;
        let bit = netmaskbits;
        if( bit == 0 || bit > 32 ) this.getNetIdBits();
        if( !bit || bit > 32 ) return false;
        let a = ip.split('.');
        if( a.length != 4 ) return false;
        let b = ip2.split('.');
        if( b.length != 4 ) return false;

        const _0_ = [ 
                    '0000000',
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
        return s == s2;
    }
}

ZWPeerMgr._shareinstacne = null;

/**
 * 这个是广播,主进程广播自己 1
 */
ZWPeerMgr.st_cmd_post_peer_to_all = 1;

/**
 * 从进程需要全部复制数据 2
 */
ZWPeerMgr.st_cmd_slave_wants_copy = 2;

/**
 * 主进程回复所有节点数据给从进程 3
 */
ZWPeerMgr.st_cmd_post_copy_to_slave = 3;

/**
 * 从进程告诉主进程 节点数据发送了变化 4
 */
ZWPeerMgr.st_cmd_slave_peer_changed = 4;

/**
 * 进程间通信,发送数据 5
 */
ZWPeerMgr.st_cmd_ipc_data_send = 5;

/**
 * 进程间通信,回复数据 6
 */
ZWPeerMgr.st_cmd_ipc_data_resb = 6;



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

    }
    /**
     * 复制一个节点数据
     * 自动转换到对应的对象,前提 属性默认值不能是undefine/null,否则没办法知道类型了
     * @param {*} src
     * @memberof ZWPeer
     */
    assignFrom( src )
    {
        let t = Object.keys( this );
        for( let one of t )
        {
            if( one.startsWith('_') ) continue;
            let l_v = this[one];
            let r_v = src[one];
            if( l_v && r_v )
            {
                let cls = Object.getPrototypeOf( l_v ).constructor;
                this[one] = new cls( src[one] );
            }
            else this[one] = r_v;
        }
    }

    copyToSend()
    {
        let r = {};
        let t = Object.keys( this );
        for( let one of t )
        {
            if( one.startsWith('_') ) continue;
            r[one] = this[one];
        }
        return r;
    }

    touch()
    {
        this._touch_at = new Date();
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
    funcIDs = {};


    /**
     * 当前状态,0:正常,1:失败率太高了,暂停使用,2:节点报活超时了,3:删除该节点
     *
     * @memberof ZWPeer
     */
    status = 0;


    pid = process.pid;

    /**
     *
     *
     * @memberof ZWPeer
     */
    _touch_at = new Date();

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
        this._callstartat[this._callid] = new Date();
        this.touch();
        return this._callid;
    }
    callEnd( callid, bok )
    {
        let callat = this._callstartat[ callid ];
        if( !callat ) return;
        delete this._callstartat[ callid ];
        let n       = new Date();
        let diff    = n.getTime() - callat.getTime();
        /**
         * @type ZWPeerStatisic
         */
        let minst     = this._mintueST;
        if( (n.getTime() - minst.createat.getTime()) > 1000*60 )
        {//超时了,重新生成一个
            this._mintueST = new ZWPeerStatisic();
            minst = this._mintueST;
        }
        let sss =  [ minst , this._allST ];
        for( let one of sss )
        {
            one.call_total_ms += diff;
            one.call_count += 1;
            one.call_succ  += (bok?1:0);
            one.call_fail  += (bok?0:1);
            one.call_avg_ms = one.call_total_ms / one.call_count;
            one.call_avg_ms = one.call_avg_ms.toFixed(0);
            one.call_fail_contine_count = bok?0:(one.call_fail_contine_count+1);
            one.call_succ_rate = one.call_succ / (one.call_succ+one.call_fail);
        }
    }

    /**
     * 调用开始记录
     * @memberof ZWPeerMgr
     */
    _callstartat = {};

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
     * 连续失败次数
     *
     * @memberof ZWPeerStatisic
     */
    call_fail_contine_count = 0;

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