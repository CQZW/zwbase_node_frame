# a srv frame base on express

使用方式,2个继承
* 1.继承 ZWBaseSrv ,然后配置路由(继承 cfgRouter 方法)),将路由请求导入到 控制器(ZWBaseCtr实例),
    ZWBaseSrv 寻找响应 ,规则:比如 xxx.com/abc/user.getinfo,
        在express框架路由里面寻找 名称为 'abc' 的 路由对象(express.Router类型由ZWRouter实现)
    ZWRouter 寻找响应, 规则:比如 xxx.com/abc/user.getinfo ,
        在ZWRouter实例 寻找 注册为 '/user' 的 控制器( ZWBaseCtr )

* 2.继承 ZWBaseCtr ,然后添加响应方法, ctr_ 开头即可,
    ZWBaseCtr 寻找响应, 规则:比如 xxx.com/abc/user.getinfo ,
    将会在ZWBaseCtr类型 实例对象里面寻找 名称为 'ctr_getinfo' 的方法名称,进行响应

    强烈建议继承 ZWBaseCtr 的时候先继承一个中间继承类,比如 xxxBaseCtr,让xxxBaseCtr 继承于 ZWBaseCtr
    然后其他控制器,继承 xxxBaseCtr,这样,项目通用行为(加解密参数检查)修改,可以放到 xxxBaseCtr

数据结构:
客户端请求参数结构:
{
    token:'xxxxx',
    userid:1,
    client:'ios/android/mac/win',
    lang:'zh',
    version:'1.0',
    deviceid:'ddddd',
    path:'/testctr/user.getinfo',//这个参数是框架自己添加的
    [file]:如果有上传文件,这个是文件对象
    //上述参数是结构性的,真正的数据在 data 里面
    data:"base64 string enc data or json str with not enc";
}
服务器返回数据结构:
{
    code:1
    msg:'ok'
    data:"base64 string enc data or json str with not enc"
}


calss TestSrv ....
    cfgRouter()
    {
        let apirouter = new zwbase.ZWRouter();

        //所有 xxx.com/api/v1/ 下面的请求都到 apirouter里面处理
        this.getApp().use( '/api/v1' , apirouter.getRouter() );
        super.cfgRouter();

        //然后 apirouter 下面 /testctr 前缀的请求都到 ctr 里面处理
        let ctr = new testCtr( this.getDB() );
        apirouter.regCtr( '/testctr' , ctr );

        //然后请求 http://127.0.0.1/api/v1/testctr.getinfo

    }
class testCtr ...

    async ctr_getinfo( param )
    {
        let retobj = { 'info:':'i am cq zw ,test ctr ' };
        return new Promise( (resolve,reject)=>{ resolve( zwbase.ZWBaseCtr.makeResb( null,retobj ) )  } );
    }