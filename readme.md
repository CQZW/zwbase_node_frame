a srv frame base on express
使用方式,2个继承
1.继承 ZWBaseSrv ,然后配置路由(继承 cfgRouter 方法)),将路由请求导入到 控制器(ZWBaseCtr实例),
    ZWBaseSrv 寻找响应 ,规则:比如 xxx.com/abc/user.getinfo,
        在express框架路由里面寻找 名称为 'abc' 的 路由对象(express.Router类型由ZWRouter实现)
    ZWRouter 寻找响应, 规则:比如 xxx.com/abc/user.getinfo ,
        在ZWRouter实例 寻找 注册为 '/user' 的 控制器( ZWBaseCtr )

2.继承 ZWBaseCtr ,然后添加响应方法, ctr_ 开头即可,
    ZWBaseCtr 寻找响应, 规则:比如 xxx.com/abc/user.getinfo ,
    将会在ZWBaseCtr类型 实例对象里面寻找 名称为 'ctr_getinfo' 的方法名称,进行响应

    强烈建议继承 ZWBaseCtr 的时候先继承一个中间继承类,比如 xxxBaseCtr,让xxxBaseCtr 继承于 ZWBaseCtr
    然后其他控制器,继承 xxxBaseCtr,这样,项目通用行为(加解密参数检查)修改,可以放到 xxxBaseCtr


数据结构:
        控制器输入参数(客户端请求的时候),真实参数放入 data,
        控制器输出,通用的结构   { code,msg,data }
         

calss TestSrv ....
    cfgRouter()
    {
        let apirouter = new zwbase.ZWRouter();

        //所有 xxx.com/api/v1/ 下面的请求都到 apirouter里面处理
        this.getApp().use( '/api/v1' , apirouter.getRouter() );
        super.cfgRouter();

        //下面具体设置 这个 路由的规则
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