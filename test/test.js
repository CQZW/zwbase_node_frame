 
 class testc
 {
     constructor(a) {
         
     }
     Prop1 = 1;

     getinfo()
     {
         return '222';
     }
     toJSON()
     {
         return '11';
     }
 }
let xx = Symbol('aaa');
let bbb =[];
bbb.push( xx );

 console.log( xx === bbb[0] );
 